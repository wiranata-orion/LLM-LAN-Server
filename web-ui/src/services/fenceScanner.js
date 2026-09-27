/**
 * Shared low-level scanner behind every ```<tag> widget parser
 * (flashcardParser.js, mindMapParser.js, decisionMatrixParser.js -
 * clarificationParser.js and mermaidParser.js predate this and keep their
 * own copy of the same logic; not worth the churn of retrofitting two
 * already-shipped, already-tested parsers just to save a few lines).
 *
 * Splits markdown into ordered {type:'text'} / {type:'block', raw} segments
 * for one specific fence tag, leaving everything else (prose, other fence
 * tags, ordinary ```js code blocks) untouched in the 'text' segments. A
 * block only becomes {type:'block'} once its closing fence has actually
 * arrived - mid-stream, an unclosed block is not yet valid JSON, so it stays
 * visible as plain text (same as an unclosed ```js block already does)
 * rather than being handed to a JSON.parse() that's guaranteed to throw.
 */
export function scanFencedBlocks(markdown, tag) {
  const openPattern = new RegExp(`^ {0,3}\`\`\`${tag}\\s*$`)
  const closePattern = /^ {0,3}```\s*$/

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
      if (openPattern.test(line)) fenceBuffer = []
      else textBuffer.push(line)
      continue
    }

    if (closePattern.test(line)) {
      flushText()
      segments.push({ type: 'block', raw: fenceBuffer.join('\n') })
      fenceBuffer = null
      continue
    }

    fenceBuffer.push(line)
  }

  if (fenceBuffer !== null) textBuffer.push(`\`\`\`${tag}`, ...fenceBuffer)
  flushText()

  return segments
}

/**
 * Turns scanFencedBlocks()'s generic {type:'block', raw} into the specific
 * segment shape MessageBubble.vue's widget components expect, running `raw`
 * through JSON.parse + a validator. An invalid block (bad JSON, or JSON that
 * fails validation) falls back to visible plain text instead of vanishing.
 * @param {string} markdown
 * @param {string} tag Fence tag, e.g. 'flashcards'.
 * @param {(parsed: unknown) => object | null} validate Returns the cleaned schema, or null if unusable.
 */
export function parseWidgetSegments(markdown, tag, validate) {
  return scanFencedBlocks(markdown, tag).flatMap((segment) => {
    if (segment.type === 'text') return [segment]
    let schema = null
    try {
      schema = validate(JSON.parse(segment.raw))
    } catch {
      schema = null
    }
    return schema
      ? [{ type: tag, schema }]
      : [{ type: 'text', content: `\`\`\`${tag}\n${segment.raw}\n\`\`\`` }]
  })
}
