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
