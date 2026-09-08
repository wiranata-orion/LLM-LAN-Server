<script setup>
import { computed } from 'vue'
import { Bot, User, Copy, Check } from 'lucide-vue-next'
import { ref } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true,
    // { role: 'user' | 'assistant', content: string }
  },
})

const copied = ref(false)

const isUser = computed(() => props.message.role === 'user')
const isAssistant = computed(() => props.message.role === 'assistant')

function renderMarkdown(text) {
  if (!text) return ''

  let html = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Code blocks (```lang\ncode\n```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`
  })

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Blockquotes
  html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>')

  // Headings
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')

  // Unordered lists
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)

  // Ordered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')

  // Paragraphs: wrap consecutive non-block lines
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
        trimmed.startsWith('<hr')
      ) {
        return trimmed
      }
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`
    })
    .join('\n')

  return html
}

<<<<<<< Updated upstream
=======
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
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/)
    const ulMatch = line.match(/^(\s*)[-*]\s+(.*)/)

    if (olMatch || ulMatch) {
      // Collect all consecutive list lines
      const listLines = []
      while (i < lines.length) {
        const lo = lines[i].match(/^(\s*)(\d+)\.\s+(.*)/)
        const lu = lines[i].match(/^(\s*)[-*]\s+(.*)/)
        if (lo || lu) {
          const indent = (lo ? lo[1] : lu[1]).length
          const content = lo ? lo[3] : lu[2]
          const type = lo ? 'ol' : 'ul'
          const number = lo ? Number(lo[2]) : null
          listLines.push({ indent, content, type, number })
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
        html += `<${type}><li${listItemValue(item)}>${item.content}`
        stack.push({ type, indent: item.indent })
      } else {
        html += `</li><li${listItemValue(item)}>${item.content}`
      }
    } else {
      while (stack.length < level) {
        html += `<ol><li>`
        stack.push({ type: 'ol', indent: 0 })
      }
      html += `<${type}><li${listItemValue(item)}>${item.content}`
      stack.push({ type, indent: item.indent })
    }
  }

  while (stack.length > 0) {
    const popped = stack.pop()
    html += `</li></${popped.type}>`
  }

  return html
}

function listItemValue(item) {
  return item.type === 'ol' && Number.isInteger(item.number)
    ? ` value="${item.number}"`
    : ''
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

>>>>>>> Stashed changes
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
      <span class="message-role">{{ isUser ? 'You' : 'AI' }}</span>

      <div v-if="isUser" class="message-bubble message-bubble--user">
        {{ message.content }}
      </div>

      <div
        v-else
        class="message-bubble message-bubble--assistant markdown-body"
        v-html="renderMarkdown(message.content)"
      ></div>

      <!-- Actions (AI only) -->
      <div v-if="isAssistant && message.content" class="message-actions">
        <button
          class="action-btn"
          @click="copyContent"
          :title="copied ? 'Copied!' : 'Copy response'"
        >
          <Check v-if="copied" :size="14" />
          <Copy v-else :size="14" />
          <span>{{ copied ? 'Copied' : 'Copy' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-row {
  display: flex;
  gap: 12px;
  padding: 20px 24px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
  animation: fadeSlideIn 0.3s ease;
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
</style>
