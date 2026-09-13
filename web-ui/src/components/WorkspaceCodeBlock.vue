<script setup>
import { computed, ref } from 'vue'
import hljs from 'highlight.js/lib/common'
import { Check, Copy, GitCompare, FileCode, Loader2, X, Undo2, ChevronRight, ChevronDown } from 'lucide-vue-next'

const props = defineProps({
  code: { type: String, required: true },
  language: { type: String, default: '' },
  /** Set when the model labelled the fence with a path (```ts:src/app.ts). */
  filePath: { type: String, default: '' },
  isApplying: { type: Boolean, default: false },
  /** Still streaming - the block may be half-written, so writing it would be unsafe. */
  isStreaming: { type: Boolean, default: false },
  /** null = undecided (pending), 'accepted' | 'rejected' once the user has chosen. */
  decision: { type: String, default: null },
})

const emit = defineEmits(['diff', 'accept', 'reject', 'undo'])

const copied = ref(false)

// A block tied to a real file is a *proposed change*, not something to read
// here: its content is mirrored into the editor pane as a live diff, so the
// chat column shows a compact card instead of dumping the whole file into a
// narrow sidebar. Untargeted snippets (examples, shell commands) still render
// inline, since there is nowhere else for them to go.
const isFileChange = computed(() => Boolean(props.filePath))
const isExpanded = ref(false)

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
  <div
    class="ws-code-card"
    :class="{
      'ws-code-card--targeted': isActionable && !decision,
      'ws-code-card--accepted': decision === 'accepted',
      'ws-code-card--rejected': decision === 'rejected',
    }"
  >
    <div class="ws-code-header">
      <div class="ws-code-meta">
        <FileCode v-if="filePath" :size="12" class="ws-code-file-icon" />
        <span v-if="filePath" class="ws-code-path" :title="filePath">{{ filePath }}</span>
        <span v-else class="ws-code-lang">{{ language || 'code' }}</span>
        <span class="ws-code-lines">{{ lineCount }} baris</span>
        <span v-if="decision === 'accepted'" class="ws-code-decision-badge ws-code-decision-badge--accepted">
          <Check :size="11" /> Diterima
        </span>
        <span v-else-if="decision === 'rejected'" class="ws-code-decision-badge ws-code-decision-badge--rejected">
          <X :size="11" /> Ditolak
        </span>
      </div>

      <div class="ws-code-actions">
        <button class="ws-code-btn" title="Salin kode" @click="copyCode">
          <Check v-if="copied" :size="12" />
          <Copy v-else :size="12" />
          <span>{{ copied ? 'Tersalin' : 'Copy' }}</span>
        </button>

        <!-- Undecided: Accept / Reject this proposed change -->
        <template v-if="isActionable && !decision">
          <button
            class="ws-code-btn"
            title="Tampilkan perbandingan di editor"
            @click="emit('diff', { filePath, newContent: code })"
          >
            <GitCompare :size="12" />
            <span>Lihat di Editor</span>
          </button>
          <button
            class="ws-code-btn ws-code-btn--reject"
            title="Tidak - tidak ada yang ditulis ke disk"
            @click="emit('reject')"
          >
            <X :size="12" />
            <span>Tidak</span>
          </button>
          <button
            class="ws-code-btn ws-code-btn--accept"
            :disabled="isApplying"
            title="Ya - tulis isi blok ini ke file di disk"
            @click="emit('accept', { filePath, newContent: code })"
          >
            <Loader2 v-if="isApplying" :size="12" class="spin" />
            <Check v-else :size="12" />
            <span>{{ isApplying ? 'Menerapkan...' : 'Ya' }}</span>
          </button>
        </template>

        <!-- Rejected earlier: let the user change their mind without retyping the prompt -->
        <button
          v-else-if="isActionable && decision === 'rejected'"
          class="ws-code-btn"
          title="Batalkan penolakan, tinjau ulang perubahan ini"
          @click="emit('undo')"
        >
          <Undo2 :size="12" />
          <span>Batalkan Tolak</span>
        </button>
      </div>
    </div>

    <!-- A proposed file change is reviewed in the editor's diff, not read here -
         the chat column just carries a one-line summary and the decision. The
         code stays available behind a toggle for anyone who wants it inline. -->
    <template v-if="isFileChange">
      <button class="ws-code-toggle" @click="isExpanded = !isExpanded">
        <ChevronDown v-if="isExpanded" :size="12" />
        <ChevronRight v-else :size="12" />
        <span>{{ isExpanded ? 'Sembunyikan kode' : `Tampilkan kode (${lineCount} baris)` }}</span>
      </button>
      <pre v-if="isExpanded" class="ws-code-pre"><code class="hljs" v-html="highlighted"></code></pre>
    </template>

    <!-- Untargeted snippet (an example, a shell command): nothing to diff, so
         it renders inline as ordinary code. -->
    <pre v-else class="ws-code-pre"><code class="hljs" v-html="highlighted"></code></pre>

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

.ws-code-btn--accept {
  background: rgba(34, 197, 94, 0.12);
  border-color: rgba(34, 197, 94, 0.5);
  color: var(--color-success);
}

.ws-code-btn--accept:hover:not(:disabled) {
  background: var(--color-success);
  color: #fff;
}

.ws-code-btn--reject {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.4);
  color: var(--color-danger);
}

.ws-code-btn--reject:hover:not(:disabled) {
  background: var(--color-danger);
  color: #fff;
}

.ws-code-decision-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 20px;
  font-size: 0.62rem;
  font-weight: 700;
  flex-shrink: 0;
}

.ws-code-decision-badge--accepted {
  background: rgba(34, 197, 94, 0.15);
  color: var(--color-success);
}

.ws-code-decision-badge--rejected {
  background: rgba(239, 68, 68, 0.12);
  color: var(--color-danger);
}

.ws-code-card--accepted {
  border-color: rgba(34, 197, 94, 0.4);
}

.ws-code-card--rejected {
  opacity: 0.6;
}

.ws-code-card--rejected .ws-code-pre {
  text-decoration: line-through;
  text-decoration-color: rgba(239, 68, 68, 0.4);
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

.ws-code-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 5px 10px;
  border: none;
  border-top: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-size: 0.67rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: color 0.14s ease;
}

.ws-code-toggle:hover {
  color: var(--color-text-accent);
}

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
