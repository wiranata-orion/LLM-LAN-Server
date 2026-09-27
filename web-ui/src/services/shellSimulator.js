/**
 * In-Browser Code Runner (#28) - Shell/Bash simulator. There is no real
 * shell or filesystem behind this (nothing here can touch the user's actual
 * disk) - it's an in-memory virtual filesystem plus a small interpreter for
 * a deliberately bounded set of commands (ls, cat, echo, grep, find, mkdir,
 * touch, pwd, rm), enough for a self-contained script to set up a few files
 * and then demonstrate operating on them. Not POSIX-compliant, no globbing
 * beyond a simple `*` in `find -name`, no subshells, no real pipes beyond a
 * single `|` stage. This can never hang, so - unlike the JS/Python runners -
 * it doesn't need a Worker or a timeout guard.
 */

function createFs() {
  return new Map() // path (always starting with '/') -> content string
}

function normalizePath(cwd, path) {
  if (!path) return cwd
  if (path.startsWith('/')) return path.replace(/\/+$/, '') || '/'
  const combined = cwd === '/' ? `/${path}` : `${cwd}/${path}`
  return combined.replace(/\/+$/, '') || '/'
}

/** Splits a command line into tokens, respecting single/double-quoted strings. */
function tokenize(line) {
  const tokens = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = pattern.exec(line))) {
    tokens.push(match[1] ?? match[2] ?? match[3])
  }
  return tokens
}

/**
 * @param {string[]} tokens
 * @returns {{ command: string[], redirect: { path: string, append: boolean } | null }}
 */
function extractRedirection(tokens) {
  const appendIndex = tokens.indexOf('>>')
  const overwriteIndex = tokens.indexOf('>')
  const index = appendIndex !== -1 ? appendIndex : overwriteIndex
  if (index === -1) return { command: tokens, redirect: null }
  const path = tokens[index + 1]
  return { command: tokens.slice(0, index), redirect: path ? { path, append: appendIndex !== -1 } : null }
}

function runSingleCommand(tokens, fs, cwd, stdin) {
  const [name, ...args] = tokens
  switch (name) {
    case 'pwd':
      return cwd

    case 'echo':
      return args.join(' ')

    case 'mkdir':
    case 'touch': {
      for (const arg of args) {
        const path = normalizePath(cwd, arg)
        if (!fs.has(path)) fs.set(path, '')
      }
      return ''
    }

    case 'rm': {
      for (const arg of args) fs.delete(normalizePath(cwd, arg))
      return ''
    }

    case 'cat': {
      if (!args.length) return stdin ?? ''
      return args.map((arg) => {
        const path = normalizePath(cwd, arg)
        if (!fs.has(path)) throw new Error(`cat: ${arg}: No such file or directory`)
        return fs.get(path)
      }).join('\n')
    }

    case 'ls': {
      const dir = args.find((a) => !a.startsWith('-')) ? normalizePath(cwd, args.find((a) => !a.startsWith('-'))) : cwd
      const prefix = dir === '/' ? '/' : `${dir}/`
      const entries = [...fs.keys()]
        .filter((path) => path.startsWith(prefix) && path !== dir)
        .map((path) => path.slice(prefix.length).split('/')[0])
      return [...new Set(entries)].sort().join('\n')
    }

    case 'find': {
      const dir = args[0] && !args[0].startsWith('-') ? normalizePath(cwd, args[0]) : cwd
      const nameIndex = args.indexOf('-name')
      const namePattern = nameIndex !== -1 ? args[nameIndex + 1] : null
      const regex = namePattern ? new RegExp(`^${namePattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`) : null
      const prefix = dir === '/' ? '/' : `${dir}/`
      return [...fs.keys()]
        .filter((path) => path === dir || path.startsWith(prefix))
        .filter((path) => !regex || regex.test(path.split('/').pop()))
        .sort()
        .join('\n')
    }

    case 'grep': {
      const flagIndex = args.findIndex((a) => a.startsWith('-'))
      const ignoreCase = flagIndex !== -1 && args[flagIndex].includes('i')
      const positional = args.filter((a) => !a.startsWith('-'))
      const [pattern, ...fileArgs] = positional
      if (!pattern) throw new Error('grep: missing pattern')
      const regex = new RegExp(pattern, ignoreCase ? 'i' : '')
      const source = fileArgs.length
        ? fileArgs.map((arg) => {
          const path = normalizePath(cwd, arg)
          if (!fs.has(path)) throw new Error(`grep: ${arg}: No such file or directory`)
          return fs.get(path)
        }).join('\n')
        : (stdin ?? '')
      return source.split('\n').filter((line) => regex.test(line)).join('\n')
    }

    case 'awk': {
      // Deliberately minimal: only `{print $N}` and `{print}` patterns -
      // real awk is a whole language, this covers the common "print a
      // column" case the spec calls out by name and nothing more.
      const program = args.find((a) => a.startsWith('{'))
      const source = stdin ?? ''
      const columnMatch = program?.match(/\$(\d+)/)
      if (columnMatch) {
        const columnIndex = Number(columnMatch[1]) - 1
        return source.split('\n').map((line) => line.trim().split(/\s+/)[columnIndex] ?? '').join('\n')
      }
      return source
    }

    case 'cd':
      throw new Error('cd: not supported in this simulator - each command runs with a fresh cwd; use absolute paths instead')

    default:
      throw new Error(`${name}: command not found (didukung: ls, cat, echo, grep, find, awk, mkdir, touch, rm, pwd)`)
  }
}

/**
 * @param {string} script Newline-separated commands. `#` lines are comments.
 *   A single `|` per line is supported (e.g. `cat file.txt | grep pattern`);
 *   `>`/`>>` at the end of a line redirects that line's output into a file.
 * @returns {{ ok: boolean, logs: Array<{ level: 'log'|'error', message: string }>, durationMs: number }}
 */
export function runShellScript(script) {
  const startedAt = performance.now()
  const fs = createFs()
  const cwd = '/'
  const logs = []

  const lines = (script || '').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))

  for (const line of lines) {
    try {
      const stages = line.split('|').map((stage) => stage.trim())
      let pipedOutput
      for (let i = 0; i < stages.length; i += 1) {
        const isLast = i === stages.length - 1
        const { command, redirect } = extractRedirection(tokenize(stages[i]))
        const output = runSingleCommand(command, fs, cwd, pipedOutput)
        if (isLast && redirect) {
          const path = normalizePath(cwd, redirect.path)
          const existing = redirect.append ? (fs.get(path) || '') : ''
          fs.set(path, existing ? `${existing}\n${output}` : output)
        } else if (isLast) {
          if (output) logs.push({ level: 'log', message: output })
        } else {
          pipedOutput = output
        }
      }
    } catch (error) {
      logs.push({ level: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  return { ok: true, logs, durationMs: performance.now() - startedAt }
}
