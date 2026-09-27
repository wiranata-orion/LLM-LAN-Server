/**
 * Shared markdown -> HTML rendering, extracted out of MessageBubble.vue once
 * a second place (PinnedNotesDrawer.vue) needed the exact same rendering -
 * a pinned note is a verbatim copy of a message's content, so it must look
 * identical to how that message rendered in the chat itself (code blocks,
 * math, tables, etc.), not fall back to plain text.
 *
 * CommonMark via markdown-it (rather than a hand-rolled regex parser)
 * correctly handles nested lists, loose/tight paragraphs, tables without a
 * trailing "|", headings immediately followed by text, and - importantly for
 * streaming - an unclosed ``` fence just extends to the end of input instead
 * of leaking raw backticks into the page.
 */
import hljs from 'highlight.js/lib/common'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false, // never render raw HTML from model output - avoids script/style injection via prompt injection or RAG content
  linkify: true,
  breaks: true, // a single newline becomes <br>, matching how chat replies are usually written
  typographer: false,
})

// Every link (explicit [text](url) or autolinked bare URL) opens in a new tab
// safely, without exposing window.opener to the target page.
const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

// Custom fenced-code rendering: syntax highlighting plus the copy-button card,
// instead of markdown-it's plain <pre><code>.
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const lang = (token.info || '').trim().split(/\s+/)[0]
  return createCodeBlock(lang, token.content)
}

const MATH_BLOCK_TOKEN = 'XUFRUZMATHBLOCKPLACEHOLDERx'
const MATH_INLINE_TOKEN = 'XUFRUZMATHINLINEPLACEHOLDERx'
const CODE_FENCE_TOKEN = 'XUFRUZCODEFENCEPLACEHOLDERx'

// Hides fenced code blocks (closed or, mid-stream, still open) behind a
// placeholder line so the math substitution below never rewrites a literal
// "$" inside code (e.g. `echo $HOME`, "$5"). Restored verbatim before
// markdown-it runs, so its own fence parsing (see md.renderer.rules.fence)
// still sees the real ``` syntax.
//
// A closing fence must use the same character and be at least as long as the
// one that opened it - the same rule CommonMark itself uses. Without the
// length check, a fence nested inside the content (e.g. the model shows the
// contents of a markdown file that itself contains ``` example blocks) closed
// the outer block at the first nested ``` it hit, and everything after that
// point rendered with prose/code roles flipped for the rest of the message.
function protectCodeFences(text) {
  const lines = text.split('\n')
  const fences = []
  const output = []
  let fenceMarker = null
  let fenceLength = 0
  let current = []

  for (const line of lines) {
    if (!fenceMarker) {
      const open = line.match(/^ {0,3}(`{3,}|~{3,})/)
      if (open) {
        fenceMarker = open[1][0]
        fenceLength = open[1].length
        current = [line]
        continue
      }
      output.push(line)
      continue
    }

    current.push(line)
    const closePattern = fenceMarker === '`' ? /^ {0,3}(`{3,})\s*$/ : /^ {0,3}(~{3,})\s*$/
    const closeMatch = line.match(closePattern)
    if (closeMatch && closeMatch[1].length >= fenceLength) {
      fences.push(current.join('\n'))
      output.push(`${CODE_FENCE_TOKEN}${fences.length - 1}${CODE_FENCE_TOKEN}`)
      fenceMarker = null
      current = []
    }
  }
  // Streaming: the fence hasn't closed yet - protect what's there so far.
  if (fenceMarker) {
    fences.push(current.join('\n'))
    output.push(`${CODE_FENCE_TOKEN}${fences.length - 1}${CODE_FENCE_TOKEN}`)
  }

  return { text: output.join('\n'), fences }
}

export function renderMarkdown(text) {
  if (!text) return ''

  const { text: withoutCode, fences: codeFences } = protectCodeFences(text)

  // ---- LaTeX math: protect from markdown-it first (e.g. "_" in math would
  // otherwise be read as emphasis), restore the rendered formulas afterward.
  const mathBlocks = []
  const mathInlines = []
  let source = withoutCode

  // Force display math onto its own paragraph even when the model wrote it
  // mid-sentence: substituting a block-level <div> into inline text otherwise
  // leaves a <div> nested inside a <p> (invalid HTML that some browsers
  // recover from by leaving the paragraph unclosed).
  source = source.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    mathBlocks.push(formatMath(math.trim()))
    return `\n\n${MATH_BLOCK_TOKEN}${mathBlocks.length - 1}${MATH_BLOCK_TOKEN}\n\n`
  })
  source = source.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
    mathBlocks.push(formatMath(math.trim()))
    return `\n\n${MATH_BLOCK_TOKEN}${mathBlocks.length - 1}${MATH_BLOCK_TOKEN}\n\n`
  })
  source = source.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
    mathInlines.push(formatMath(math.trim()))
    return `${MATH_INLINE_TOKEN}${mathInlines.length - 1}${MATH_INLINE_TOKEN}`
  })
  source = source.replace(/\\\(([^\n]*?)\\\)/g, (_, math) => {
    mathInlines.push(formatMath(math.trim()))
    return `${MATH_INLINE_TOKEN}${mathInlines.length - 1}${MATH_INLINE_TOKEN}`
  })

  // Restore the real fence syntax now, so markdown-it parses and highlights it.
  source = source.replace(new RegExp(`${CODE_FENCE_TOKEN}(\\d+)${CODE_FENCE_TOKEN}`, 'g'), (_, i) => codeFences[Number(i)])

  let html = md.render(source)

  const blockTokenRegex = new RegExp(`(?:<p>)?${MATH_BLOCK_TOKEN}(\\d+)${MATH_BLOCK_TOKEN}(?:</p>)?`, 'g')
  html = html.replace(blockTokenRegex, (_, i) => `<div class="math-block">${mathBlocks[Number(i)]}</div>`)
  const inlineTokenRegex = new RegExp(`${MATH_INLINE_TOKEN}(\\d+)${MATH_INLINE_TOKEN}`, 'g')
  html = html.replace(inlineTokenRegex, (_, i) => `<span class="math-inline">${mathInlines[Number(i)]}</span>`)

  return html
}

function createCodeBlock(lang, code) {
  const cleanCode = code.replace(/\n$/, '')
  const safeCode = escapeHtml(cleanCode)
  let highlightedCode = safeCode

  if (lang && hljs.getLanguage(lang)) {
    highlightedCode = hljs.highlight(cleanCode, {
      language: lang,
      ignoreIllegals: true,
    }).value
  }

  return `<div class="code-card"><div class="code-header"><span class="code-lang">${lang || 'code'}</span><button class="copy-code-btn" data-code="${safeCode.replace(/"/g, '&quot;')}" onclick="copyCode(this.dataset.code)">Copy</button></div><pre><code class="language-${lang || 'plaintext'} hljs">${highlightedCode}</code></pre></div>`
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ---- LaTeX math formatter ----
function formatMath(latex) {
  let result = latex
  // Common font commands used for vectors and named operators.
  result = result.replace(/\\mathbf\{([^}]+)\}/g, '<strong class="math-bold">$1</strong>')
  result = result.replace(/\\mathrm\{([^}]+)\}/g, '<span class="math-roman">$1</span>')
  // Fractions: \frac{a}{b} → a/b styled
  result = result.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g,
    '<span class="math-frac"><span class="math-num">$1</span><span class="math-den">$2</span></span>')
  // Superscript: x^{2} or x^2
  result = result.replace(/\^{([^}]+)}/g, '<sup>$1</sup>')
  result = result.replace(/\^(\w)/g, '<sup>$1</sup>')
  // Subscript: x_{i} or x_i
  result = result.replace(/_{([^}]+)}/g, '<sub>$1</sub>')
  result = result.replace(/_(\w)/g, '<sub>$1</sub>')
  // Square root: \sqrt{x}
  result = result.replace(/\\sqrt\{([^}]+)\}/g, '√($1)')
  // Greek letters
  const greeks = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
    rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ',
    chi: 'χ', psi: 'ψ', omega: 'ω',
    Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε',
    Zeta: 'Ζ', Eta: 'Η', Theta: 'Θ', Iota: 'Ι', Kappa: 'Κ',
    Lambda: 'Λ', Mu: 'Μ', Nu: 'Ν', Xi: 'Ξ', Pi: 'Π',
    Rho: 'Ρ', Sigma: 'Σ', Tau: 'Τ', Upsilon: 'Υ', Phi: 'Φ',
    Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω',
  }
  for (const [name, symbol] of Object.entries(greeks)) {
    result = result.replace(new RegExp(`\\\\${name}\\b`, 'g'), symbol)
  }
  // Math operators
  result = result.replace(/\\times/g, '×')
  result = result.replace(/\\div/g, '÷')
  result = result.replace(/\\pm/g, '±')
  result = result.replace(/\\mp/g, '∓')
  result = result.replace(/\\cdot/g, '·')
  result = result.replace(/\\leq/g, '≤')
  result = result.replace(/\\geq/g, '≥')
  result = result.replace(/\\neq/g, '≠')
  result = result.replace(/\\approx/g, '≈')
  result = result.replace(/\\infty/g, '∞')
  result = result.replace(/\\sum/g, '∑')
  result = result.replace(/\\prod/g, '∏')
  result = result.replace(/\\int/g, '∫')
  result = result.replace(/\\partial/g, '∂')
  result = result.replace(/\\nabla/g, '∇')
  result = result.replace(/\\forall/g, '∀')
  result = result.replace(/\\exists/g, '∃')
  result = result.replace(/\\in/g, '∈')
  result = result.replace(/\\notin/g, '∉')
  result = result.replace(/\\subset/g, '⊂')
  result = result.replace(/\\supset/g, '⊃')
  result = result.replace(/\\cup/g, '∪')
  result = result.replace(/\\cap/g, '∩')
  result = result.replace(/\\rightarrow/g, '→')
  result = result.replace(/\\leftarrow/g, '←')
  result = result.replace(/\\Rightarrow/g, '⇒')
  result = result.replace(/\\Leftarrow/g, '⇐')
  result = result.replace(/\\therefore/g, '∴')
  result = result.replace(/\\because/g, '∵')
  // Brackets
  result = result.replace(/\\left\(/g, '(')
  result = result.replace(/\\right\)/g, ')')
  result = result.replace(/\\left\[/g, '[')
  result = result.replace(/\\right\]/g, ']')
  result = result.replace(/\\{/g, '{')
  result = result.replace(/\\}/g, '}')
  // Text inside math
  result = result.replace(/\\text\{([^}]+)\}/g, '<span class="math-text">$1</span>')
  // Clean remaining backslashes from unknown commands
  result = result.replace(/\\([a-zA-Z]+)/g, '$1')
  return result
}

// Copy code block content - assigned to window because createCodeBlock's
// output is raw HTML (inserted via v-html), so its onclick can only ever
// reach a plain global function, not a component method.
async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code)
  } catch (err) {
    console.error('Copy code failed:', err)
  }
}

window.copyCode = copyCode
