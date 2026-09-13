import path from 'node:path'

export interface CodeChunk {
  chunkIndex: number
  /** 1-based, inclusive - matches what an editor shows in its gutter. */
  startLine: number
  endLine: number
  /** Declaration name the chunk opens with, when one could be recognised. */
  symbol: string | null
  content: string
}

export interface ChunkCodeOptions {
  maxLines: number
  maxChars: number
}

/**
 * Language-agnostic declaration detectors. These deliberately only recognise
 * *low-indentation* declarations: the goal is to cut a file between its
 * top-level units, not to split every nested arrow function into its own
 * chunk. Anything unrecognised (CSS, JSON, prose) falls back to fixed-size
 * slicing, which is fine - those have no function structure to preserve.
 */
const DECLARATION_PATTERNS: Array<{ regex: RegExp; nameGroup: number }> = [
  // export function foo / async function foo / function* foo
  { regex: /^\s{0,4}(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, nameGroup: 1 },
  // export class Foo / abstract class Foo / interface Foo / enum Foo / type Foo
  { regex: /^\s{0,4}(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|interface|enum|type|struct|trait|impl)\s+([A-Za-z_$][\w$]*)/, nameGroup: 1 },
  // export const foo = (…) => / = async (…) => / = function
  { regex: /^\s{0,4}(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/, nameGroup: 1 },
  // Python: def foo / async def foo / class Foo
  { regex: /^\s{0,4}(?:async\s+)?def\s+([A-Za-z_][\w]*)/, nameGroup: 1 },
  { regex: /^\s{0,4}class\s+([A-Za-z_][\w]*)/, nameGroup: 1 },
  // PHP / Java / C# methods with a visibility keyword
  { regex: /^\s{0,4}(?:public|private|protected|internal)\s+(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:[\w<>\[\],?]+\s+)?([A-Za-z_$][\w$]*)\s*\(/, nameGroup: 1 },
  { regex: /^\s{0,4}(?:public|private|protected|final|abstract|static)*\s*function\s+&?\s*([A-Za-z_][\w]*)/, nameGroup: 1 },
  // Go / Rust
  { regex: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/, nameGroup: 1 },
  { regex: /^\s{0,4}(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/, nameGroup: 1 },
  // Ruby
  { regex: /^\s{0,4}(?:def|module)\s+([A-Za-z_][\w:.]*)/, nameGroup: 1 },
  // Markdown headings - the closest thing docs have to a declaration
  { regex: /^(#{1,3})\s+(.+)$/, nameGroup: 2 },
]

/** Vue/Svelte/Astro single-file components split cleanly at their block tags. */
const SFC_BLOCK_PATTERN = /^<(template|script|style)(\s[^>]*)?>/

function detectDeclaration(line: string): { isBoundary: boolean; symbol: string | null } {
  if (SFC_BLOCK_PATTERN.test(line)) {
    return { isBoundary: true, symbol: line.match(SFC_BLOCK_PATTERN)?.[1] ?? null }
  }
  for (const { regex, nameGroup } of DECLARATION_PATTERNS) {
    const match = line.match(regex)
    if (match) return { isBoundary: true, symbol: match[nameGroup]?.trim() || null }
  }
  return { isBoundary: false, symbol: null }
}

interface Block {
  startLine: number
  endLine: number
  symbol: string | null
  lines: string[]
  characters: number
}

/**
 * Splits source into blocks at declaration boundaries, then packs consecutive
 * blocks together until the size cap - so a file of twenty one-line helpers
 * becomes a couple of useful chunks instead of twenty near-empty ones, while a
 * single large function still gets a chunk of its own.
 *
 * Oversized blocks are hard-split; the caps exist because the embedding model
 * (nomic-embed-text) silently truncates anything past roughly 2k tokens, so a
 * larger chunk would be embedded from only its opening lines.
 */
export function chunkCode(content: string, options: ChunkCodeOptions): CodeChunk[] {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.trim()) return []

  const lines = normalized.split('\n')
  const maxLines = Math.max(options.maxLines, 10)
  const maxChars = Math.max(options.maxChars, 500)

  // ---- Pass 1: cut into declaration blocks.
  const blocks: Block[] = []
  let current: Block | null = null

  const pushCurrent = () => {
    if (current && current.lines.some((line) => line.trim())) blocks.push(current)
    current = null
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const { isBoundary, symbol } = detectDeclaration(line)

    // Only start a new block on a boundary if the current one has real content -
    // otherwise a decorated/annotated declaration would split from its own body.
    if (isBoundary && current && current.lines.some((entry) => entry.trim())) {
      pushCurrent()
    }
    if (!current) {
      current = { startLine: index + 1, endLine: index + 1, symbol: isBoundary ? symbol : null, lines: [], characters: 0 }
    }
    current.lines.push(line)
    current.endLine = index + 1
    current.characters += line.length + 1

    // A block that has grown past the cap without hitting a boundary (minified
    // output, giant data literals) is cut here rather than at a boundary.
    if (current.lines.length >= maxLines || current.characters >= maxChars) {
      pushCurrent()
    }
  }
  pushCurrent()

  // ---- Pass 2: pack small consecutive blocks up to the cap.
  const chunks: CodeChunk[] = []
  let pending: Block | null = null

  const flush = () => {
    if (!pending) return
    const text = pending.lines.join('\n').trim()
    if (text) {
      chunks.push({
        chunkIndex: chunks.length,
        startLine: pending.startLine,
        endLine: pending.endLine,
        symbol: pending.symbol,
        content: text,
      })
    }
    pending = null
  }

  for (const block of blocks) {
    if (!pending) {
      pending = { ...block, lines: [...block.lines] }
      continue
    }
    const combinedLines = pending.lines.length + block.lines.length
    const combinedChars = pending.characters + block.characters
    if (combinedLines <= maxLines && combinedChars <= maxChars) {
      pending.lines.push(...block.lines)
      pending.endLine = block.endLine
      pending.characters = combinedChars
      // Keep the first recognised symbol as the chunk's label.
      pending.symbol = pending.symbol ?? block.symbol
      continue
    }
    flush()
    pending = { ...block, lines: [...block.lines] }
  }
  flush()

  return chunks
}

/**
 * The header prepended to each chunk before embedding. Without it, two files
 * with similar bodies (an index.ts in five different folders) embed almost
 * identically and retrieval can't tell them apart; the path and symbol also
 * make the retrieved chunk self-describing once it lands in the prompt.
 */
export function describeChunk(relPath: string, chunk: CodeChunk): string {
  const language = path.extname(relPath).replace('.', '') || 'text'
  const symbolPart = chunk.symbol ? ` · ${chunk.symbol}` : ''
  return `File: ${relPath} (${language}, lines ${chunk.startLine}-${chunk.endLine})${symbolPart}\n\n${chunk.content}`
}
