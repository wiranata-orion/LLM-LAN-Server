/**
 * Interactive Terminal Output Parser (#13) - light, format-agnostic cleanup
 * of a pasted raw log (Laravel stack trace, Node exception, Docker build
 * log, anything) before it goes to the model: strip ANSI color codes,
 * collapse exact-duplicate spam lines (a retry loop, a repeated warning),
 * and keep only the head + tail of a very long log rather than the
 * (probably irrelevant) middle - the actual failure is almost always at the
 * end, and the head usually carries the command/context that produced it.
 * This never tries to be a real log parser per tool/language; the model
 * still does the actual root-cause reasoning, on cleaner input.
 */

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g
const MAX_HEAD_LINES = 6
const MAX_TAIL_LINES = 60

/**
 * @param {string} raw
 * @returns {{ text: string, truncated: boolean, originalLineCount: number }}
 */
export function cleanTerminalLog(raw) {
  const withoutAnsi = (raw || '').replace(ANSI_PATTERN, '')
  const lines = withoutAnsi.split('\n').map((line) => line.replace(/\r$/, ''))

  // Collapse consecutive exact duplicates into one line + a "(×N)" count,
  // instead of deleting them - the repetition count itself can be a useful
  // signal (e.g. a retry loop), just not N copies of the identical line.
  const collapsed = []
  for (const line of lines) {
    const last = collapsed[collapsed.length - 1]
    if (last && last.text === line && line.trim()) {
      last.count += 1
    } else {
      collapsed.push({ text: line, count: 1 })
    }
  }
  const collapsedLines = collapsed.map((entry) => (entry.count > 1 ? `${entry.text} (×${entry.count})` : entry.text))

  let kept = collapsedLines
  let truncated = false
  if (collapsedLines.length > MAX_HEAD_LINES + MAX_TAIL_LINES + 1) {
    const omitted = collapsedLines.length - MAX_HEAD_LINES - MAX_TAIL_LINES
    kept = [
      ...collapsedLines.slice(0, MAX_HEAD_LINES),
      `... (${omitted} baris di tengah dipotong) ...`,
      ...collapsedLines.slice(-MAX_TAIL_LINES),
    ]
    truncated = true
  }

  return { text: kept.join('\n'), truncated, originalLineCount: lines.length }
}

const ERROR_SIGNATURE_PATTERNS = [
  /Traceback \(most recent call last\):/,
  /^\s*(Error|TypeError|ReferenceError|SyntaxError|RangeError|EvalError|URIError):\s*.+$/m,
  /Uncaught\s+(\w*Error):\s*.+/,
  /^\s*Fatal error:\s*.+$/mi,
  /panic:\s*.+/,
  /Segmentation fault/i,
  /Exception in thread\s*.+/,
  /^\s*\w*Exception:\s*.+$/m,
]

/**
 * A quick, scannable headline for the raw log - pulled from the FIRST
 * matching known error signature, so the user sees at a glance what this is
 * even before (or without) asking the AI to analyze it.
 * @param {string} raw
 * @returns {string | null}
 */
export function detectErrorSignature(raw) {
  const text = raw || ''
  for (const pattern of ERROR_SIGNATURE_PATTERNS) {
    const match = text.match(pattern)
    if (match) return match[0].trim().slice(0, 300)
  }
  return null
}
