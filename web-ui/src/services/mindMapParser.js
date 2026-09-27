import { parseWidgetSegments } from './fenceScanner.js'

/** @typedef {{ label: string, children: MindMapNode[] }} MindMapNode */

const MAX_DEPTH = 8 // guards against a pathological/cyclic tree hanging the recursive renderer

function validateNode(node, depth) {
  if (!node || typeof node !== 'object' || typeof node.label !== 'string') return null
  if (depth >= MAX_DEPTH) return { label: node.label, children: [] }
  const children = Array.isArray(node.children)
    ? node.children.map((child) => validateNode(child, depth + 1)).filter(Boolean)
    : []
  return { label: node.label, children }
}

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') return null
  const root = validateNode(parsed.root, 0)
  return root ? { root } : null
}

/** @param {string} markdown */
export function parseMindMapSegments(markdown) {
  return parseWidgetSegments(markdown, 'mindmap', validate)
}
