/**
 * Extracts ```clarify fenced JSON blocks from a markdown string - the same
 * fence convention MessageBubble.vue already treats specially for
 * ```mermaid/code (see its protectCodeFences), just for a different tag.
 *
 * A model wanting to ask a clarifying question (see the ClarificationCard
 * schema below) emits one of these mid-reply:
 *
 *   Sebelum saya lanjutkan, ada beberapa hal yang perlu dipastikan:
 *
 *   ```clarify
 *   { "id": "clarify-1", "prompt": "...", "questions": [ ... ] }
 *   ```
 *
 * This never touches rendering itself - it just splits the raw text into
 * plain-prose segments and clarification-card segments, in order, so a
 * caller (MessageBubble.vue) can render the prose through its normal
 * markdown pipeline and mount a real <ClarificationCard> component for each
 * card instead - v-html can never run a live, interactive Vue component, only
 * static HTML, which is why this can't just be another markdown-it rule.
 */

const FENCE_OPEN = /^ {0,3}```clarify\s*$/
const FENCE_CLOSE = /^ {0,3}```\s*$/

/**
 * @typedef {{ id: string, text: string, type: 'single' | 'multi', options: Array<{ id: string, label: string }>, allowOther?: boolean }} ClarificationQuestion
 * @typedef {{ id: string, prompt: string, questions: ClarificationQuestion[] }} ClarificationSchema
 */

/** @returns {ClarificationSchema | null} null if the parsed JSON isn't a usable clarification card. */
function validateSchema(parsed) {
  if (!parsed || typeof parsed !== 'object') return null
  if (typeof parsed.prompt !== 'string' || !Array.isArray(parsed.questions) || !parsed.questions.length) return null

  const questions = parsed.questions.filter((q) => (
    q && typeof q.id === 'string' && typeof q.text === 'string'
    && (q.type === 'single' || q.type === 'multi')
    && Array.isArray(q.options) && q.options.length > 0
    && q.options.every((o) => o && typeof o.id === 'string' && typeof o.label === 'string')
  ))
  if (!questions.length) return null

  return {
    id: typeof parsed.id === 'string' ? parsed.id : `clarify-${Date.now()}`,
    prompt: parsed.prompt,
    questions: questions.map((q) => ({ ...q, allowOther: q.allowOther === true })),
  }
}

/**
 * @param {string} markdown
 * @returns {Array<{ type: 'text', content: string } | { type: 'clarify', schema: ClarificationSchema }>}
 *   Segments in original order. A malformed ```clarify block (bad JSON, or
 *   JSON that fails validateSchema) is left as an ordinary 'text' segment
 *   verbatim - it renders as a plain code block rather than silently
 *   vanishing, which is what happened while the block was still streaming in
 *   and not yet valid JSON.
 */
export function parseClarificationSegments(markdown) {
  const lines = markdown.split('\n')
  const segments = []
  let textBuffer = []
  let fenceBuffer = null // string[] while inside a ```clarify ... ``` block

  const flushText = () => {
    if (textBuffer.length) {
      segments.push({ type: 'text', content: textBuffer.join('\n') })
      textBuffer = []
    }
  }

  for (const line of lines) {
    if (fenceBuffer === null) {
      if (FENCE_OPEN.test(line)) {
        fenceBuffer = []
      } else {
        textBuffer.push(line)
      }
      continue
    }

    if (FENCE_CLOSE.test(line)) {
      flushText()
      const raw = fenceBuffer.join('\n')
      fenceBuffer = null
      let schema = null
      try {
        schema = validateSchema(JSON.parse(raw))
      } catch {
        schema = null
      }
      if (schema) {
        segments.push({ type: 'clarify', schema })
      } else {
        // Not (yet) valid - keep it visible as a plain fenced block rather
        // than eating it silently, e.g. while it's still streaming in.
        segments.push({ type: 'text', content: '```clarify\n' + raw + '\n```' })
      }
      continue
    }

    fenceBuffer.push(line)
  }

  // An unclosed ```clarify block (still streaming) is not yet valid JSON -
  // show it as plain text for now; it becomes a card once the fence closes.
  if (fenceBuffer !== null) textBuffer.push('```clarify', ...fenceBuffer)
  flushText()

  return segments
}
