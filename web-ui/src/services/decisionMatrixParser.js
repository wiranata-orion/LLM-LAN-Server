import { parseWidgetSegments } from './fenceScanner.js'

/**
 * @typedef {{
 *   title: string,
 *   criteria: Array<{ id: string, label: string, weight: number }>,
 *   options: Array<{ id: string, label: string, scores: Record<string, number>, pros?: string[], cons?: string[] }>,
 * }} DecisionMatrixSchema
 */

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') return null
  if (typeof parsed.title !== 'string') return null

  const criteria = Array.isArray(parsed.criteria) ? parsed.criteria.filter((c) => (
    c && typeof c.id === 'string' && typeof c.label === 'string' && typeof c.weight === 'number' && c.weight > 0
  )) : []
  if (!criteria.length) return null

  const criteriaIds = new Set(criteria.map((c) => c.id))
  const options = Array.isArray(parsed.options) ? parsed.options.filter((o) => (
    o && typeof o.id === 'string' && typeof o.label === 'string' && o.scores && typeof o.scores === 'object'
  )) : []
  if (options.length < 2) return null

  return {
    title: parsed.title,
    criteria,
    options: options.map((option) => ({
      id: option.id,
      label: option.label,
      // Missing/invalid scores default to 0 rather than dropping the whole
      // option - a model that forgot one criterion for one option
      // shouldn't lose that option from the comparison entirely.
      scores: Object.fromEntries([...criteriaIds].map((id) => [id, Number(option.scores[id]) || 0])),
      pros: Array.isArray(option.pros) ? option.pros.filter((p) => typeof p === 'string') : [],
      cons: Array.isArray(option.cons) ? option.cons.filter((c) => typeof c === 'string') : [],
    })),
  }
}

/** @param {string} markdown */
export function parseDecisionMatrixSegments(markdown) {
  return parseWidgetSegments(markdown, 'decision-matrix', validate)
}
