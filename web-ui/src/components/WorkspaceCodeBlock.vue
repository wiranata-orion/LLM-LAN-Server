<script setup>
import { computed, ref } from 'vue'
import hljs from 'highlight.js/lib/common'
import { Check, Copy, GitCompare, FileCode, Loader2 } from 'lucide-vue-next'

const props = defineProps({
  code: { type: String, required: true },
  language: { type: String, default: '' },
  /** Set when the model labelled the fence with a path (```ts:src/app.ts). */
  filePath: { type: String, default: '' },
  isApplying: { type: Boolean, default: false },
  /** Still streaming - the block may be half-written, so writing it would be unsafe. */
  isStreaming: { type: Boolean, default: false },
})

const emit = defineEmits(['diff', 'apply'])

const copied = ref(false)

// Only a block the model tied to a real file can be diffed or written.
const isActionable = computed(() => Boolean(props.filePath) && !props.isStreaming)

const highlighted = computed(() => {
  const language = hljsLanguage(props.language, props.filePath)
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(props.code, { language, ignoreIllegals: true }).value
    } catch {
      // fall through
    }
  }
  return escapeHtml(props.code)
})

const lineCount = computed(() => props.code.split('\n').length)

function hljsLanguage(fenceLanguage, filePath) {
  const map = {
    ts: 'typescript', typescript: 'typescript', tsx: 'typescript',
    js: 'javascript', javascript: 'javascript', jsx: 'javascript',
    py: 'python', python: 'python', rb: 'ruby', php: 'php',
    go: 'go', rust: 'rust', rs: 'rust', java: 'java', cs: 'csharp',
    c: 'c', cpp: 'cpp', sql: 'sql', json: 'json', yaml: 'yaml', yml: 'yaml',
    bash: 'bash', sh: 'bash', shell: 'bash', powershell: 'powershell', ps1: 'powershell',
    html: 'xml', xml: 'xml', vue: 'xml', svelte: 'xml',
    css: 'css', scss: 'scss', less: 'less', markdown: 'markdown', md: 'markdown',
  }
  if (fenceLanguage && map[fenceLanguage.toLowerCase()]) return map[fenceLanguage.toLowerCase()]
  const extension = (filePath.split('.').pop() || '').toLowerCase()
  return map[extension] || null
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch (error) {
    console.error('Copy failed:', error)
  }
}
</script>

<template>
  <div class="ws-code-card" :class="{ 'ws-code-card--targeted': isActionable }">
    <div class="ws-code-header">
      <div class="ws-code-meta">
        <FileCode v-if="filePath" :size="12" class="ws-code-file-icon" />
        <span v-if="filePath" class="ws-code-path" :title="filePath">{{ filePath }}</span>
        <span v-else class="ws-code-lang">{{ language || 'code' }}</span>
        <span class="ws-code-lines">{{ lineCount }} baris</span>
      </div>

      <div class="ws-code-actions">
        <button class="ws-code-btn" title="Salin kode" @click="copyCode">
          <Check v-if="copied" :size="12" />
          <Copy v-else :size="12" />
          <span>{{ copied ? 'Tersalin' : 'Copy' }}</span>
        </button>

        <button
          v-if="isActionable"
          class="ws-code-btn"
          title="Bandingkan dengan isi file saat ini"
          @click="emit('diff', { filePath, newContent: code })"
        >
          <GitCompare :size="12" />
          <span>Diff View</span>
        </button>

        <button
          v-if="isActionable"
          class="ws-code-btn ws-code-btn--apply"
          :disabled="isApplying"
          title="Tulis isi blok ini ke file di disk"
          @click="emit('apply', { filePath, newContent: code })"
        >
          <Loader2 v-if="isApplying" :size="12" class="spin" />
          <Check v-else :size="12" />
          <span>{{ isApplying ? 'Menerapkan...' : 'Apply Changes' }}</span>
        </button>
      </div>
    </div>

    <pre class="ws-code-pre"><code class="hljs" v-html="highlighted"></code></pre>

    <p v-if="!filePath && !isStreaming" class="ws-code-hint">
      Blok ini tidak diberi label path, jadi tidak bisa diterapkan otomatis. Minta AI menulis ulang
      dengan format <code>```bahasa:path/file.ts</code>.
    </p>
  </div>
</template>

<style scoped>
.ws-code-card {
  margin: 8px 0;
  border: 1px solid var(--color-border);
  border-radius: 9px;
  background: var(--color-bg-input);
  overflow: hidden;
}

.ws-code-card--targeted {
  border-color: rgba(139, 92, 246, 0.45);
}

.ws-code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 8px;
  background: var(--color-bg-tertiary);
  border-bottom: 1px solid var(--color-border);
  flex-wrap: wrap;
}

.ws-code-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ws-code-file-icon {
  color: var(--color-text-accent);
  flex-shrink: 0;
}

.ws-code-path {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--color-text-accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
}

.ws-code-lang {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
}

.ws-code-lines {
  font-size: 0.64rem;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.ws-code-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.ws-code-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-input);
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-size: 0.66rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.16s ease;
  white-space: nowrap;
}

.ws-code-btn:hover:not(:disabled) {
  color: var(--color-text-primary);
  border-color: var(--color-border-light);
}

.ws-code-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ws-code-btn--apply {
  background: var(--color-accent-subtle);
  border-color: rgba(139, 92, 246, 0.5);
  color: var(--color-text-accent);
}

.ws-code-btn--apply:hover:not(:disabled) {
  background: var(--color-accent);
  color: #fff;
}

.ws-code-pre {
  margin: 0;
  padding: 10px 12px;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  line-height: 1.55;
  color: var(--color-text-primary);
}

.ws-code-pre :deep(.hljs-keyword),
.ws-code-pre :deep(.hljs-built_in) { color: #c084fc; }
.ws-code-pre :deep(.hljs-string) { color: #86efac; }
.ws-code-pre :deep(.hljs-comment) { color: var(--color-text-muted); font-style: italic; }
.ws-code-pre :deep(.hljs-number) { color: #fbbf24; }
.ws-code-pre :deep(.hljs-title) { color: #60a5fa; }
.ws-code-pre :deep(.hljs-attr) { color: #f472b6; }

.ws-code-hint {
  margin: 0;
  padding: 6px 10px;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
  font-size: 0.68rem;
  line-height: 1.5;
}

.ws-code-hint code {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  color: var(--color-text-secondary);
}

.spin {
  animation: ws-code-spin 1s linear infinite;
}

@keyframes ws-code-spin {
  to { transform: rotate(360deg); }
}
</style>
