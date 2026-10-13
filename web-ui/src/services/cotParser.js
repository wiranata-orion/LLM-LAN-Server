/**
 * Chain of Thought (CoT) / Reasoning Tokens parser.
 * Handles DeepSeek-R1, QwQ, and other reasoning models that emit
 * <think>...</think>, <thought>...</thought>, or <reasoning>...</reasoning> blocks.
 */

export function parseChainOfThought(content) {
  if (!content || typeof content !== 'string') {
    return {
      hasThought: false,
      thought: '',
      answer: '',
      isThinking: false,
      wordCount: 0,
    }
  }

  // 1. Check for unclosed open tag at the end (active streaming of thought)
  const openTagMatch = content.match(/<(think|thought|reasoning)>([\s\S]*)$/i)
  if (openTagMatch && !/<\/(think|thought|reasoning)>/i.test(openTagMatch[2])) {
    const thought = openTagMatch[2].replace(/^[\r\n]+/, '')
    const prefix = content.slice(0, openTagMatch.index)
    const words = thought.trim() ? thought.trim().split(/\s+/).length : 0
    return {
      hasThought: true,
      thought,
      answer: prefix.trim(),
      isThinking: true,
      wordCount: words,
    }
  }

  // 2. Check for closed tags (may be multiple)
  const closedTagRegex = /<(think|thought|reasoning)>([\s\S]*?)<\/\1>/gi
  const thoughts = []
  let hasClosed = false

  let answer = content.replace(closedTagRegex, (_, _tag, thoughtContent) => {
    hasClosed = true
    const trimmed = thoughtContent.trim()
    if (trimmed) {
      thoughts.push(trimmed)
    }
    return ''
  })

  // 3. Check for orphan closing tag at the start (some models start thinking without opening tag)
  const orphanCloseMatch = answer.match(/^([\s\S]*?)<\/(think|thought|reasoning)>/i)
  if (orphanCloseMatch) {
    hasClosed = true
    const orphanThought = orphanCloseMatch[1].trim()
    if (orphanThought) {
      thoughts.unshift(orphanThought)
    }
    answer = answer.slice(orphanCloseMatch[0].length)
  }

  if (hasClosed && thoughts.length > 0) {
    const combinedThought = thoughts.join('\n\n---\n\n')
    const words = combinedThought.trim().split(/\s+/).length
    return {
      hasThought: true,
      thought: combinedThought,
      answer: answer.trim(),
      isThinking: false,
      wordCount: words,
    }
  }

  return {
    hasThought: false,
    thought: '',
    answer: content,
    isThinking: false,
    wordCount: 0,
  }
}
