<script setup>
import { computed } from 'vue'
import { Bot, User, Copy, Check } from 'lucide-vue-next'
import hljs from 'highlight.js/lib/common'
import { ref } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true,
    // { role: 'user' | 'assistant', content: string }
  },
  isGenerating: {
    type: Boolean,
    default: false,
  },
})

const copied = ref(false)

const isUser = computed(() => props.message.role === 'user')
const isAssistant = computed(() => props.message.role === 'assistant')
const isThinking = computed(() => isAssistant.value && props.isGenerating && !props.message.content)

function renderMarkdown(text) {
  if (!text) return ''

  let html = text

  // ---- Code blocks: extract and protect first ----
  const codeBlocks = []
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const placeholder = `%%CODEBLOCK_${codeBlocks.length}%%`
    codeBlocks.push(createCodeBlock(lang, code))
    return placeholder
  })

  // Render an unfinished code block while the response is still streaming.
  html = html.replace(/```(\w*)\n([\s\S]*)$/g, (_, lang, code) => {
    const placeholder = `%%CODEBLOCK_${codeBlocks.length}%%`
    codeBlocks.push(createCodeBlock(lang, code))
    return placeholder
  })

  // Escape HTML (after code blocks are protected)
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // ---- LaTeX Math ----
  // Display math: $$...$$
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    return `<div class="math-block">${formatMath(math.trim())}</div>`
  })
  // Inline math: $...$
  html = html.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
    return `<span class="math-inline">${formatMath(math.trim())}</span>`
  })

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')

  // Blockquotes
  html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>')

  // Headings
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')

  // ---- Tables ----
  html = html.replace(/((?:^\|.+\|$\n?)+)/gm, (tableBlock) => {
    const rows = tableBlock.trim().split('\n').filter(r => r.trim())
    if (rows.length < 2) return tableBlock
    // Check if second row is a separator row (|---|---|)
    const sepRow = rows[1]
    if (!/^\|[\s\-:|]+\|$/.test(sepRow)) return tableBlock
    const headerCells = rows[0].split('|').filter((c, i, a) => i > 0 && i < a.length - 1).map(c => c.trim())
    const bodyRows = rows.slice(2)
    let tableHtml = '<table><thead><tr>'
    headerCells.forEach(c => { tableHtml += `<th>${c}</th>` })
    tableHtml += '</tr></thead><tbody>'
    bodyRows.forEach(row => {
      const cells = row.split('|').filter((c, i, a) => i > 0 && i < a.length - 1).map(c => c.trim())
      tableHtml += '<tr>'
      cells.forEach(c => { tableHtml += `<td>${c}</td>` })
      tableHtml += '</tr>'
    })
    tableHtml += '</tbody></table>'
    return tableHtml
  })

  // ---- Nested lists (stack-based) ----
  html = processLists(html)

  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    html = html.replace(`%%CODEBLOCK_${i}%%`, block)
  })

  // Paragraphs: wrap non-block lines
  html = html
    .split('\n\n')
    .map((block) => {
      const trimmed = block.trim()
      if (!trimmed) return ''
      if (
        trimmed.startsWith('<pre') ||
        trimmed.startsWith('<h') ||
        trimmed.startsWith('<ul') ||
        trimmed.startsWith('<ol') ||
        trimmed.startsWith('<blockquote') ||
        trimmed.startsWith('<hr') ||
        trimmed.startsWith('<div') ||
        trimmed.startsWith('<table') ||
        trimmed.startsWith('%%CODEBLOCK')
      ) {
        return trimmed
      }
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`
    })
    .join('\n')

  return html
}

function createCodeBlock(lang, code) {
  const cleanCode = code.trim()
  const safeCode = escapeHtml(cleanCode)
  let highlightedCode = safeCode

  if (lang && hljs.getLanguage(lang)) {
    highlightedCode = hljs.highlight(cleanCode, {
      language: lang,
      ignoreIllegals: true,
    }).value
  }

  return `<div class="code-card"><div class="code-header"><span class="code-lang">${lang || 'code'}</span><button class="copy-code-btn" data-code="${safeCode.replace(/"/g, '&quot;')}" onclick="copyCode(this.dataset.code)">Copy</button></div><pre><code class="language-${lang} hljs">${highlightedCode}</code></pre></div>`
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ---- Process nested lists ----
function processLists(html) {
  const lines = html.split('\n')
  const result = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    // Check if this line is a list item (ordered or unordered)
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)/)
    const ulMatch = line.match(/^(\s*)[-*]\s+(.*)/)

    if (olMatch || ulMatch) {
      // Collect all consecutive list lines
      const listLines = []
      while (i < lines.length) {
        const lo = lines[i].match(/^(\s*)\d+\.\s+(.*)/)
        const lu = lines[i].match(/^(\s*)[-*]\s+(.*)/)
        if (lo || lu) {
          const indent = (lo ? lo[1] : lu[1]).length
          const content = lo ? lo[2] : lu[2]
          const type = lo ? 'ol' : 'ul'
          listLines.push({ indent, content, type })
          i++
        } else if (!lines[i].trim() && i + 1 < lines.length) {
          const nextIsList = /^(\s*)(?:\d+\.|[-*])\s+/.test(lines[i + 1])
          if (nextIsList) {
            i++
          } else {
            break
          }
        } else {
          break
        }
      }
      result.push(buildNestedList(listLines))
    } else {
      result.push(line)
      i++
    }
  }
  return result.join('\n')
}

function buildNestedList(items) {
  if (items.length === 0) return ''

  let html = ''
  const stack = [] // { type, indent }
  const minIndent = Math.min(...items.map(it => it.indent))

  for (const item of items) {
    const level = Math.floor((item.indent - minIndent) / 2)
    const type = item.type

    while (stack.length > level + 1) {
      const popped = stack.pop()
      html += `</li></${popped.type}>`
    }

    if (stack.length === level + 1) {
      if (stack[stack.length - 1].type !== type) {
        const popped = stack.pop()
        html += `</li></${popped.type}>`
        html += `<${type}><li>${item.content}`
        stack.push({ type, indent: item.indent })
      } else {
        html += `</li><li>${item.content}`
      }
    } else {
      while (stack.length < level) {
        html += `<ol><li>`
        stack.push({ type: 'ol', indent: 0 })
      }
      html += `<${type}><li>${item.content}`
      stack.push({ type, indent: item.indent })
    }
  }

  while (stack.length > 0) {
    const popped = stack.pop()
    html += `</li></${popped.type}>`
  }

  return html
}

// ---- LaTeX math formatter ----
function formatMath(latex) {
  let result = latex
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

async function copyContent() {
  try {
    await navigator.clipboard.writeText(props.message.content)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch (err) {
    console.error('Copy failed:', err)
  }
}

// Copy code block content
async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code)
    // optional visual feedback could be added here
    console.log('Code copied')
  } catch (err) {
    console.error('Copy code failed:', err)
  }
}

window.copyCode = copyCode
</script>

<template>
  <div
    class="message-row"
    :class="{ 'message-row--user': isUser, 'message-row--assistant': isAssistant }"
  >
    <!-- Avatar -->
    <div class="message-avatar" :class="{ 'message-avatar--user': isUser }">
      <User v-if="isUser" :size="18" />
      <Bot v-else :size="18" />
    </div>

    <!-- Content -->
    <div class="message-content-wrapper">
      <span class="message-role">{{ isUser ? 'You' : 'Xufruz' }}</span>

      <div v-if="isUser" class="message-bubble message-bubble--user">
        {{ message.content }}
      </div>

      <div v-if="isThinking" class="thinking-indicator" aria-label="Thinking">
        <span>Thinking</span><span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      </div>

      <div
        v-else-if="isAssistant"
        class="message-bubble message-bubble--assistant markdown-body"
        v-html="renderMarkdown(message.content)"
      ></div>

      <!-- Actions (AI only) -->

    </div>
  </div>
</template>

<style>
.message-row {
  display: flex;
  gap: 12px;
  padding: 20px 24px;
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
  animation: fadeSlideIn 0.3s ease;
}

/* Separator line only after assistant (AI) messages */
.message-row--assistant {
  border-bottom: 1px solid var(--color-border);
}

.message-row--assistant:last-child {
  border-bottom: none;
}

@keyframes fadeSlideIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-tertiary);
  color: var(--color-text-accent);
  border: 1px solid var(--color-border);
  margin-top: 4px;
}

.message-avatar--user {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
}

.message-content-wrapper {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.message-role {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.message-bubble {
  font-size: 0.925rem;
  line-height: 1.7;
}

.message-bubble--user {
  color: var(--color-text-primary);
  white-space: pre-wrap;
}

.message-bubble--assistant {
  color: var(--color-ai-bubble-text);
}

.thinking-indicator {
  display: inline-flex;
  align-items: baseline;
  color: var(--color-text-muted);
  font-size: 0.925rem;
  line-height: 1.7;
}

.thinking-dots {
  display: inline-flex;
  gap: 3px;
  margin-left: 3px;
}

.thinking-dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  animation: thinkingPulse 1.2s infinite ease-in-out;
}

.thinking-dots i:nth-child(2) {
  animation-delay: 0.15s;
}

.thinking-dots i:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes thinkingPulse {
  0%, 60%, 100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

.message-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.message-row:hover .message-actions {
  opacity: 1;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 0.75rem;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: var(--font-sans);
}

.action-btn:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-light);
  background: var(--color-bg-hover);
}

/* ===== Code block card ===== */
.code-card {
  background: var(--color-bg-secondary);
  border-radius: 8px;
  margin: 12px 0;
  overflow: hidden;
  box-shadow: 0 2px 6px var(--color-shadow);
}

.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--color-bg-tertiary);
  padding: 4px 8px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.code-lang {
  font-family: var(--font-mono);
}

.copy-code-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 2px 6px;
}

.copy-code-btn:hover {
  color: var(--color-text-primary);
}

/* Syntax highlighting tokens */
.markdown-body .hljs-keyword,
.markdown-body .hljs-selector-tag,
.markdown-body .hljs-literal,
.markdown-body .hljs-type {
  color: #c084fc;
}

.markdown-body .hljs-string,
.markdown-body .hljs-title,
.markdown-body .hljs-section,
.markdown-body .hljs-attribute {
  color: #86efac;
}

.markdown-body .hljs-number,
.markdown-body .hljs-variable,
.markdown-body .hljs-template-variable {
  color: #fbbf24;
}

.markdown-body .hljs-comment,
.markdown-body .hljs-quote {
  color: #94a3b8;
  font-style: italic;
}

.markdown-body .hljs-built_in,
.markdown-body .hljs-symbol,
.markdown-body .hljs-bullet {
  color: #67e8f9;
}

/* ===== List styling (nested) ===== */
.markdown-body ol,
.markdown-body ul {
  margin: 0.4em 0;
  padding-left: 1.5em;
}

.markdown-body ol {
  list-style-type: decimal;
}

.markdown-body ul {
  list-style-type: disc;
}

.markdown-body li {
  margin: 0.2em 0;
  padding-left: 0.2em;
}

/* Nested list indentation */
.markdown-body ol ol,
.markdown-body ul ol,
.markdown-body ol ul,
.markdown-body ul ul {
  margin: 0.2em 0;
  padding-left: 1.5em;
}

.markdown-body ol ol {
  list-style-type: lower-alpha;
}

.markdown-body ol ol ol {
  list-style-type: lower-roman;
}

.markdown-body ul ul {
  list-style-type: circle;
}

.markdown-body ul ul ul {
  list-style-type: square;
}

/* ===== Math formula styling ===== */
.math-block {
  display: block;
  text-align: center;
  padding: 16px 20px;
  margin: 12px 0;
  background: var(--color-bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--color-border);
  font-size: 1.1em;
  font-family: 'Cambria Math', 'Latin Modern Math', 'STIX Two Math', Georgia, serif;
  letter-spacing: 0.02em;
  overflow-x: auto;
}

.math-inline {
  font-family: 'Cambria Math', 'Latin Modern Math', 'STIX Two Math', Georgia, serif;
  font-style: italic;
  padding: 1px 4px;
  background: rgba(139, 92, 246, 0.08);
  border-radius: 4px;
  font-size: 0.95em;
}

.math-frac {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  vertical-align: middle;
  margin: 0 4px;
}

.math-num {
  border-bottom: 1.5px solid currentColor;
  padding: 0 4px 2px;
  line-height: 1.3;
}

.math-den {
  padding: 2px 4px 0;
  line-height: 1.3;
}

.math-text {
  font-style: normal;
  font-family: var(--font-sans);
}

/* ===== Table styling ===== */
.markdown-body table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
  font-size: 0.88rem;
}

.markdown-body th,
.markdown-body td {
  border: 1px solid var(--color-border);
  padding: 8px 12px;
  text-align: left;
}

.markdown-body th {
  background: var(--color-bg-tertiary);
  font-weight: 600;
  color: var(--color-text-primary);
}

.markdown-body td {
  color: var(--color-text-secondary);
}

.markdown-body tr:hover td {
  background: var(--color-bg-hover);
}

/* ===== Blockquote styling ===== */
.markdown-body blockquote {
  border-left: 3px solid var(--color-accent);
  margin: 8px 0;
  padding: 4px 16px;
  color: var(--color-text-secondary);
  background: rgba(139, 92, 246, 0.05);
  border-radius: 0 6px 6px 0;
}

/* ===== Heading styling ===== */
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4 {
  margin: 16px 0 8px;
  color: var(--color-text-primary);
  line-height: 1.4;
}

.markdown-body h1 { font-size: 1.4em; }
.markdown-body h2 { font-size: 1.2em; }
.markdown-body h3 { font-size: 1.05em; }
.markdown-body h4 { font-size: 0.95em; }

/* ===== Inline code ===== */
.markdown-body code {
  background: var(--color-bg-tertiary);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.88em;
}

/* ===== Horizontal rule ===== */
.markdown-body hr {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 16px 0;
}

/* ===== Links ===== */
.markdown-body a {
  color: var(--color-accent);
  text-decoration: none;
}

.markdown-body a:hover {
  text-decoration: underline;
}

/* ===== Strikethrough ===== */
.markdown-body del {
  opacity: 0.6;
}

/* ===== Paragraphs ===== */
.markdown-body p {
  margin: 0.5em 0;
}
</style>

