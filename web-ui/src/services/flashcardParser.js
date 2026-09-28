import { parseWidgetSegments } from './fenceScanner.js'

/**
 * @typedef {{ mode: 'flashcard', cards: Array<{ front: string, back: string }> }
 *         | { mode: 'quiz', questions: Array<{ question: string, options: string[], correctIndex: number, explanation?: string }> }} FlashcardSchema
 */

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') return null

  if (parsed.mode === 'quiz') {
    const questions = Array.isArray(parsed.questions) ? parsed.questions.filter((q) => (
      q && typeof q.question === 'string'
      && Array.isArray(q.options) && q.options.length >= 2 && q.options.every((o) => typeof o === 'string')
      && typeof q.correctIndex === 'number' && q.correctIndex >= 0 && q.correctIndex < q.options.length
    )) : []
    if (!questions.length) return null
    return {
      mode: 'quiz',
      questions: questions.map((q) => ({ ...q, explanation: typeof q.explanation === 'string' ? q.explanation : '' })),
    }
  }

  // Default to flashcard mode even if `mode` is missing - the field only
  // exists to distinguish quiz, so absence should mean the common case.
  const cards = Array.isArray(parsed.cards) ? parsed.cards.filter((c) => (
    c && typeof c.front === 'string' && typeof c.back === 'string'
  )) : []
  if (!cards.length) return null
  return { mode: 'flashcard', cards }
}

/** @param {string} markdown */
export function parseFlashcardSegments(markdown) {
  return parseWidgetSegments(markdown, 'flashcards', validate)
}
