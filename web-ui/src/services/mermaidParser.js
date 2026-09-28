/**
 * Extracts ```mermaid fenced blocks from a markdown string - same fence
 * convention and same reason as clarificationParser.js's ```clarify: v-html
 * can render the diagram's static SVG output fine, but MermaidDiagram.vue's
 * zoom/pan/export controls need to be a real, live Vue component, which
 * v-html can never mount.
 *
 * Meant to run on the 'text' segments parseClarificationSegments() already
 * produced, not on raw message content directly - see MessageBubble.vue's
 * assistantSegments, which chains the two. That keeps each parser small and
 * single-purpose instead of one parser that has to know about every fence
 * type that might ever be added.
 */

const FENCE_OPEN = /^ {0,3}```mermaid\s*$/
const FENCE_CLOSE = /^ {0,3}```\s*$/

/**
 * @param {string} markdown
 * @returns {Array<{ type: 'text', content: string } | { type: 'mermaid', source: string }>}
 *   A ```mermaid block only becomes a 'mermaid' segment once its closing
 *   fence has actually arrived - mid-stream, an unclosed block is almost
 *   certainly not yet valid diagram syntax, so it stays visible as plain text
 *   (exactly like an unclosed ```js block already does) rather than being
 *   handed to mermaid.render() and thrown away on a parse error.
 */
export function parseMermaidSegments(markdown) {
  const lines = markdown.split('\n')
  const segments = []
  let textBuffer = []
  let fenceBuffer = null

  const flushText = () => {
    if (textBuffer.length) {
      segments.push({ type: 'text', content: textBuffer.join('\n') })
      textBuffer = []
    }
  }

  for (const line of lines) {
    if (fenceBuffer === null) {
      if (FENCE_OPEN.test(line)) fenceBuffer = []
      else textBuffer.push(line)
      continue
    }

    if (FENCE_CLOSE.test(line)) {
      flushText()
      segments.push({ type: 'mermaid', source: fenceBuffer.join('\n') })
      fenceBuffer = null
      continue
    }

    fenceBuffer.push(line)
  }

  if (fenceBuffer !== null) textBuffer.push('```mermaid', ...fenceBuffer)
  flushText()

  return segments
}
