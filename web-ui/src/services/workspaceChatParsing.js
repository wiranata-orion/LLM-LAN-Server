/**
 * Splits an AI Coding Assistant reply into prose and code segments, and works
 * out which file (if any) each code block targets.
 *
 * Shared between WorkspaceChatPanel.vue (rendering) and workspaceStore.js
 * (which needs the same segment list to know which files currently have a
 * pending, undecided change - see pendingFilePaths in workspaceStore.js) so
 * the two never disagree about what a reply contains.
 */

/**
 * Splits on fenced code blocks.
 *
 * Line-based rather than one big regex because replies are parsed on every
 * token while streaming: a fence that hasn't closed yet must still render as
 * code (just not an applicable one) instead of leaking raw backticks.
 *
 * A closing fence must use the same character and be at least as long as the
 * one that opened it - the same rule CommonMark itself uses. Without the
 * length check, a fence nested inside the content (e.g. the model shows the
 * contents of a markdown file that itself contains ``` example blocks) closes
 * the outer block at the FIRST nested ``` it hits, and everything after that
 * point renders with prose/code roles flipped for the rest of the message.
 */
export function parseWorkspaceReplySegments(content, options = {}) {
  const lines = content.split('\n')
  const segments = []
  let inCode = false
  let fenceCharacter = ''
  let fenceLength = 0
  let fenceInfo = ''
  let buffer = []

  const flushText = () => {
    const text = buffer.join('\n')
    if (text.trim()) segments.push({ kind: 'text', content: text })
    buffer = []
  }

  const flushCode = (closed) => {
    const previousText = [...segments].reverse().find((segment) => segment.kind === 'text')
    const { language, filePath } = resolveCodeTarget(fenceInfo, buffer, previousText?.content || '')
    segments.push({ kind: 'code', language, filePath, content: buffer.join('\n'), closed })
    buffer = []
  }

  for (const line of lines) {
    if (!inCode) {
      const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (open) {
        flushText()
        inCode = true
        fenceCharacter = open[1][0]
        fenceLength = open[1].length
        fenceInfo = open[2] || ''
        continue
      }
      buffer.push(line)
      continue
    }

    const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)
    if (close && close[1][0] === fenceCharacter && close[1].length >= fenceLength) {
      flushCode(true)
      inCode = false
      continue
    }
    buffer.push(line)
  }

  if (inCode) flushCode(false)
  else flushText()

  return applyFallbackFilePath(segments, options.fallbackFilePath)
}

/**
 * Last-resort fallback when none of resolveCodeTarget()'s heuristics found a
 * path: measured against a real local model (asked to rewrite an explicitly
 * named file), the reply correctly rewrote the file's content but opened the
 * fence with just "```markdown" - no ":README.md" - and nothing preceded the
 * fence for the "mentioned just above" heuristic to catch either. Without
 * this, a reply that visibly did the right thing still has no Accept/Reject
 * buttons, because nothing could be attached to it.
 *
 * Only applied when it's unambiguous: exactly one unresolved code block in
 * the whole reply, and exactly one file the user explicitly named - two of
 * either would make "which one" a guess instead of a safe inference.
 */
function applyFallbackFilePath(segments, fallbackFilePath) {
  if (!fallbackFilePath) return segments
  const codeSegments = segments.filter((segment) => segment.kind === 'code')
  const unresolved = codeSegments.filter((segment) => !segment.filePath)
  if (codeSegments.length === 1 && unresolved.length === 1) {
    unresolved[0].filePath = fallbackFilePath
  }
  return segments
}

/**
 * The single explicitly-@-referenced file for a reply, when there is exactly
 * one - the safe candidate for applyFallbackFilePath() above. Derived from
 * the context blocks the server reported actually being shown to the model
 * (see WorkspaceContextBlock in agent-server/src/types.ts), not by re-parsing
 * the user's prompt text.
 */
export function deriveFallbackFilePath(contextBlocks) {
  if (!contextBlocks?.length) return null
  const explicitPaths = [...new Set(
    contextBlocks.filter((block) => block.reason === 'explicit').map((block) => block.relPath),
  )]
  return explicitPaths.length === 1 ? explicitPaths[0] : null
}

/**
 * Works out which file a code block belongs to.
 *
 * The system prompt asks for "```ts:src/app.ts", but local models drift, so
 * three fallbacks follow - without a path the block can't be diffed, accepted
 * or rejected, which is the whole point of the panel.
 */
export function resolveCodeTarget(fenceInfo, codeLines, precedingText) {
  const info = (fenceInfo || '').trim()

  // 1. The documented form: ```lang:path/to/file.ts
  if (info.includes(':')) {
    const [language, ...rest] = info.split(':')
    const filePath = rest.join(':').trim()
    if (looksLikePath(filePath)) return { language: language.trim(), filePath: normalizePath(filePath) }
  }

  // 2. A bare path as the fence info: ```src/app.ts
  if (looksLikePath(info) && !info.includes(' ')) {
    return { language: extensionOf(info), filePath: normalizePath(info) }
  }

  // 3. A path in the first line of the code, as a comment.
  const firstLine = (codeLines[0] || '').trim()
  const commentPath = firstLine.match(/^(?:\/\/|#|--|<!--|\/\*)\s*([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)\s*(?:-->|\*\/)?$/)
  if (commentPath && looksLikePath(commentPath[1])) {
    return { language: info || extensionOf(commentPath[1]), filePath: normalizePath(commentPath[1]) }
  }

  // 4. A path named just above the block ("update `src/app.ts`:" / "**src/app.ts**").
  const tail = precedingText.split('\n').slice(-2).join(' ')
  const mentioned = tail.match(/[`*"']([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)[`*"']/)
  if (mentioned && looksLikePath(mentioned[1])) {
    return { language: info || extensionOf(mentioned[1]), filePath: normalizePath(mentioned[1]) }
  }

  return { language: info, filePath: '' }
}

function looksLikePath(value) {
  if (!value) return false
  // Needs an extension; a bare word like "bash" is a language, not a file.
  return /\.[A-Za-z0-9]+$/.test(value) && !/\s/.test(value)
}

function normalizePath(value) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function extensionOf(value) {
  return (value.split('.').pop() || '').toLowerCase()
}
