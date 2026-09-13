import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Which files Vibe Coding is allowed to read, index and overwrite.
 *
 * Three layers, applied in order:
 *   1. Built-in deny rules - dependency/build/secret folders that are never
 *      worth embedding and, in the case of .env, must never be shipped into a
 *      prompt at all.
 *   2. The project's own `.vibeignore` (gitignore-like syntax, `!` un-ignores).
 *   3. An extension allowlist - source and docs only, so a stray .png or
 *      .sqlite can't be read as text and embedded as noise.
 */

// Patterns are matched with the same engine as .vibeignore entries, so a user
// can override any of them from their own file with "!pattern".
const DEFAULT_IGNORE_PATTERNS = [
  // Version control and tooling metadata
  '.git/', '.svn/', '.hg/', '.idea/', '.vscode/', '.vs/',
  // Dependencies and vendored code
  'node_modules/', 'vendor/', 'bower_components/', 'jspm_packages/',
  'venv/', '.venv/', 'env/', '__pycache__/', '.tox/', 'site-packages/',
  // Build output
  'dist/', 'build/', 'out/', 'target/', 'bin/', 'obj/',
  '.next/', '.nuxt/', '.output/', '.svelte-kit/', '.turbo/', '.parcel-cache/',
  'coverage/', '.nyc_output/', '.cache/', '.pytest_cache/', '.mypy_cache/',
  // Secrets - never index, never inline into a prompt
  '.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx', 'id_rsa*', '*.keystore',
  // Generated noise that is technically text but has no explanatory value
  '*.min.js', '*.min.css', '*.map', '*-lock.json', 'package-lock.json',
  'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'poetry.lock', 'Cargo.lock',
  // This app's own storage, if the user ever points a workspace at its data dir
  'memory_core.sqlite*', 'vector-store.sqlite*', 'workspace-index.sqlite*',
  '.vibe-backups/',
]

/** Text formats worth embedding. Anything else is listed in the tree but never indexed. */
const INDEXABLE_EXTENSIONS = new Set([
  // Explicitly requested
  '.ts', '.js', '.py', '.php', '.vue', '.html', '.css', '.json', '.md',
  // Same families, same value
  '.tsx', '.jsx', '.mts', '.cts', '.mjs', '.cjs',
  '.scss', '.sass', '.less', '.styl',
  '.svelte', '.astro', '.htm', '.ejs', '.hbs', '.twig', '.blade.php',
  '.go', '.rs', '.java', '.kt', '.kts', '.rb', '.swift', '.dart',
  '.c', '.h', '.cpp', '.cc', '.hpp', '.cs', '.m', '.mm',
  '.sql', '.graphql', '.gql', '.proto',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.properties',
  '.txt', '.markdown', '.mdx', '.rst', '.adoc',
  '.xml', '.svg', '.csv', '.tsv',
  '.gitignore', '.dockerignore', '.editorconfig', '.vibeignore',
])

/** Extension-less filenames that are still real source/config worth reading. */
const INDEXABLE_FILENAMES = new Set([
  'dockerfile', 'makefile', 'procfile', 'rakefile', 'gemfile', 'brewfile',
  'jenkinsfile', 'vagrantfile', 'caddyfile', 'readme', 'license', 'changelog',
])

interface CompiledPattern {
  regex: RegExp
  negated: boolean
  directoryOnly: boolean
  /** True when the pattern contains a slash and so is matched against the whole relative path. */
  pathScoped: boolean
}

function globToRegExpSource(glob: string): string {
  let source = ''
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]
    if (character === '*') {
      if (glob[index + 1] === '*') {
        // "**" spans directory separators; "**/" should also match zero directories.
        index += 1
        if (glob[index + 1] === '/') {
          index += 1
          source += '(?:.*/)?'
        } else {
          source += '.*'
        }
      } else {
        source += '[^/]*'
      }
      continue
    }
    if (character === '?') {
      source += '[^/]'
      continue
    }
    // Everything else is a literal, including regex metacharacters.
    source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return source
}

function compilePattern(rawPattern: string): CompiledPattern | null {
  let pattern = rawPattern.trim()
  if (!pattern || pattern.startsWith('#')) return null

  const negated = pattern.startsWith('!')
  if (negated) pattern = pattern.slice(1).trim()
  if (!pattern) return null

  const directoryOnly = pattern.endsWith('/')
  if (directoryOnly) pattern = pattern.slice(0, -1)

  const anchored = pattern.startsWith('/')
  if (anchored) pattern = pattern.slice(1)
  if (!pattern) return null

  // A path-scoped pattern ("src/generated", "/dist") is matched against the
  // whole relative path; a bare name ("node_modules", "*.log") is matched
  // against a single path segment, at any depth - gitignore semantics.
  const pathScoped = anchored || pattern.includes('/')
  const regex = new RegExp(`^${globToRegExpSource(pattern)}$`)

  return { regex, negated, directoryOnly, pathScoped }
}

function toPosix(relPath: string): string {
  return relPath.split(path.sep).join('/').replace(/^\.\//, '')
}

export class WorkspaceFilter {
  private patterns: CompiledPattern[] = []

  private constructor(private readonly workspaceRoot: string) {
    this.reload()
  }

  static load(workspaceRoot: string): WorkspaceFilter {
    return new WorkspaceFilter(workspaceRoot)
  }

  /** Re-reads `.vibeignore`; called when the watcher sees that file change. */
  reload(): void {
    const fromFile: string[] = []
    const vibeignorePath = path.join(this.workspaceRoot, '.vibeignore')
    if (existsSync(vibeignorePath)) {
      try {
        fromFile.push(...readFileSync(vibeignorePath, 'utf8').split(/\r?\n/))
      } catch (error) {
        console.warn(`Could not read ${vibeignorePath}:`, error)
      }
    }
    // Project rules come last so a "!" line there can re-include something a
    // built-in rule excluded.
    this.patterns = [...DEFAULT_IGNORE_PATTERNS, ...fromFile]
      .map(compilePattern)
      .filter((pattern): pattern is CompiledPattern => pattern !== null)
  }

  /**
   * @param relPath Path relative to the workspace root (either separator style).
   * @param isDirectory Directory-only patterns ("dist/") apply only to directories.
   *
   * A rule that matches a directory also excludes everything beneath it, so
   * "node_modules/" hides node_modules/vue/index.js even though this is asked
   * about the file directly (the tree walker skips the directory before ever
   * descending, but the watcher and apply-changes ask about full file paths).
   */
  isIgnored(relPath: string, isDirectory: boolean): boolean {
    const posixPath = toPosix(relPath)
    if (!posixPath || posixPath === '.') return false
    const segments = posixPath.split('/')

    // Every ancestor directory of this entry, as a path from the root:
    // "src/generated/api.ts" -> ["src", "src/generated"]
    const ancestors: string[] = []
    for (let index = 0; index < segments.length - 1; index += 1) {
      ancestors.push(segments.slice(0, index + 1).join('/'))
    }

    const matches = (pattern: CompiledPattern, candidatePath: string, candidateIsDirectory: boolean): boolean => {
      if (pattern.directoryOnly && !candidateIsDirectory) return false
      if (pattern.pathScoped) return pattern.regex.test(candidatePath)
      const name = candidatePath.slice(candidatePath.lastIndexOf('/') + 1)
      return pattern.regex.test(name)
    }

    let ignored = false
    for (const pattern of this.patterns) {
      const matched = matches(pattern, posixPath, isDirectory)
        || ancestors.some((ancestor) => matches(pattern, ancestor, true))
      // Later rules win, which is what makes a trailing "!pattern" an un-ignore.
      if (matched) ignored = !pattern.negated
    }
    return ignored
  }

  /** True when the file should be read, chunked and embedded. */
  isIndexableFile(relPath: string, sizeBytes: number, maxFileBytes: number): boolean {
    if (this.isIgnored(relPath, false)) return false
    if (sizeBytes > maxFileBytes) return false
    return isIndexableExtension(relPath)
  }
}

/** Extension/filename check only - no ignore rules, no size check. */
export function isIndexableExtension(relPath: string): boolean {
  const basename = path.basename(relPath).toLowerCase()
  if (INDEXABLE_FILENAMES.has(basename)) return true
  if (INDEXABLE_EXTENSIONS.has(basename)) return true // e.g. ".gitignore" has no stem
  // ".blade.php" style double extensions, then the plain one.
  const doubleExtension = basename.match(/(\.[^.]+\.[^.]+)$/)?.[1]
  if (doubleExtension && INDEXABLE_EXTENSIONS.has(doubleExtension)) return true
  const extension = path.extname(basename)
  return extension.length > 0 && INDEXABLE_EXTENSIONS.has(extension)
}

/**
 * A last-resort content check for files that pass the extension allowlist but
 * turn out to hold binary data (a .json that is really a packed blob, say).
 * A NUL byte never appears in real UTF-8 source.
 */
export function looksBinary(content: string): boolean {
  const sample = content.slice(0, 4000)
  if (!sample.length) return false
  let suspicious = 0
  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index)
    if (code === 0) return true
    const isControl = code < 32 && code !== 9 && code !== 10 && code !== 13
    if (isControl || code === 0xfffd) suspicious += 1
  }
  return suspicious / sample.length > 0.05
}

export const WORKSPACE_DEFAULT_IGNORE_PATTERNS = DEFAULT_IGNORE_PATTERNS
