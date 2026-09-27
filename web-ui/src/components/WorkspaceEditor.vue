<script setup>
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import hljs from 'highlight.js/lib/common'
import {
  Check,
  X,
  FileCode,
  GitCompare,
  Loader2,
  AlertTriangle,
  Eye,
  ListPlus,
  ShieldAlert,
  CircleQuestionMark,
  FlaskConical,
  Wand2,
} from 'lucide-vue-next'
import { diffLines, collapseUnchanged } from '../services/diff.js'
import { addSelectionAsContext } from '../services/workspaceStore.js'
import { scanForVulnerabilities } from '../services/securityScanner.js'
import { getSettings } from '../services/api.js'

const props = defineProps({
  // { relPath, content, lines, truncated } or null when nothing is open.
  file: { type: Object, default: null },
  // { filePath, newContent, streaming, messageIndex, segmentIndex } - a change
  // the model proposed. `streaming` is true while it is still being written,
  // which is exactly when this pane mirrors it live.
  proposal: { type: Object, default: null },
  isApplying: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
})

// 'context-action' carries { action, startLine, endLine, snippet } - see
// handleContextAction below; WorkspaceView.vue turns it into a staged
// context attachment plus a matching chat prompt.
const emit = defineEmits(['accept', 'reject', 'close-file', 'context-action'])

const showFullDiff = ref(false)
const diffBodyRef = ref(null)

const isDiffMode = computed(() => props.proposal !== null)
const isStreamingProposal = computed(() => props.proposal?.streaming === true)

const diffResult = computed(() => {
  if (!props.proposal) return null
  // A proposal for a file that isn't open (or a brand-new file) diffs against
  // empty, which renders as an all-additions view - correct for file creation.
  const baseline = props.file && props.file.relPath === props.proposal.filePath ? props.file.content : ''
  return diffLines(baseline, props.proposal.newContent)
})

const diffRows = computed(() => {
  if (!diffResult.value) return []
  return showFullDiff.value ? diffResult.value.rows : collapseUnchanged(diffResult.value.rows, 3)
})

/**
 * A weak local model that loses track of the request sometimes discards the
 * file and writes something unrelated instead of a targeted edit - the surest
 * sign of that is a huge chunk of the original file vanishing. This flags it
 * so the user double-checks before writing it to disk, instead of the diff
 * stats (+N/-N) quietly speaking for themselves in a corner of the header.
 */
const destructiveWarning = computed(() => {
  if (!diffResult.value || isStreamingProposal.value) return null
  const isExistingFile = props.file && props.file.relPath === props.proposal?.filePath
  if (!isExistingFile) return null
  const baselineLines = props.file.content ? props.file.content.split('\n').length : 0
  if (baselineLines < 6) return null
  const removed = diffResult.value.removed
  const added = diffResult.value.added
  if (removed < Math.max(8, baselineLines * 0.4)) return null
  if (added > removed * 0.6) return null // a genuine large rewrite the user asked for, not a wipe
  const percent = Math.round((removed / baselineLines) * 100)
  return `Perubahan ini menghapus ${removed} dari ${baselineLines} baris asli file (~${percent}%) tanpa menambahkan proporsi kode yang sepadan - ini bisa jadi tanda AI menulis ulang file tanpa arah yang jelas. Periksa dengan teliti sebelum menekan "Ya".`
})

/** Syntax-highlighted lines for the plain (non-diff) view. */
const highlightedLines = computed(() => {
  if (!props.file) return []
  const language = languageFor(props.file.relPath)
  const code = props.file.content
  if (language && hljs.getLanguage(language)) {
    try {
      const html = hljs.highlight(code, { language, ignoreIllegals: true }).value
      return html.split('\n')
    } catch {
      // fall through to plain text
    }
  }
  return code.split('\n').map(escapeHtml)
})

function languageFor(relPath) {
  const extension = (relPath.split('.').pop() || '').toLowerCase()
  const map = {
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    py: 'python', rb: 'ruby', php: 'php', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin', cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c',
    html: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml',
    css: 'css', scss: 'scss', less: 'less',
    json: 'json', yml: 'yaml', yaml: 'yaml', sql: 'sql', md: 'markdown',
    sh: 'bash', bash: 'bash', ps1: 'powershell',
  }
  return map[extension] || null
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// While the model streams a change in, follow the newest lines - unless the
// user has scrolled up to read something earlier, in which case leave them be.
const userScrolledAway = ref(false)

function handleDiffScroll() {
  const element = diffBodyRef.value
  if (!element) return
  userScrolledAway.value = element.scrollHeight - element.scrollTop - element.clientHeight > 32
}

watch(
  () => props.proposal?.newContent,
  () => {
    if (!isStreamingProposal.value || userScrolledAway.value) return
    nextTick(() => {
      const element = diffBodyRef.value
      if (element) element.scrollTop = element.scrollHeight
    })
  },
)

// A brand-new proposal starts at the top, following from there.
watch(() => props.proposal?.filePath, () => {
  userScrolledAway.value = false
})

// A likely destructive rewrite (see destructiveWarning above) needs a second,
// explicit confirmation before "Ya" actually writes it to disk.
const confirmingDestructive = ref(false)
watch(() => props.proposal, () => { confirmingDestructive.value = false })

function confirmDestructiveAccept() {
  confirmingDestructive.value = false
  emit('accept')
}

// ===== "Add selection to context" =====
// Selecting a range in the plain (non-diff) file view surfaces a small button
// near the selection, so the user can hand the AI exactly the lines that
// matter instead of the whole file - the same mechanism that keeps the AI
// from being asked to blindly rewrite a file it can only see part of (see
// SHARED_RULES in workspace-rag.ts on the agent-server).
const codeViewRef = ref(null)
const selectionAction = ref(null) // { top, left, startLine, endLine, snippet } | null

function clearSelectionAction() {
  selectionAction.value = null
}

function handleCodeSelection() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    clearSelectionAction()
    return
  }
  const container = codeViewRef.value
  if (!container) return
  const range = selection.getRangeAt(0)
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    clearSelectionAction()
    return
  }

  const startRow = range.startContainer.nodeType === 1
    ? range.startContainer.closest('tr[data-line]')
    : range.startContainer.parentElement?.closest('tr[data-line]')
  const endRow = range.endContainer.nodeType === 1
    ? range.endContainer.closest('tr[data-line]')
    : range.endContainer.parentElement?.closest('tr[data-line]')
  if (!startRow || !endRow) {
    clearSelectionAction()
    return
  }

  const startLine = Math.min(Number(startRow.dataset.line), Number(endRow.dataset.line))
  const endLine = Math.max(Number(startRow.dataset.line), Number(endRow.dataset.line))
  const rect = range.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  selectionAction.value = {
    top: rect.top - containerRect.top + container.scrollTop,
    left: rect.left - containerRect.left,
    startLine,
    endLine,
    snippet: selection.toString(),
  }
}

watch(() => props.file?.relPath, clearSelectionAction)

// ===== Security & Vulnerability Scanner (#9) - see securityScanner.js =====
// Settings > Keamanan & Web's sensitivity: 'disabled' skips the scan
// entirely, 'moderate' keeps only 'high' severity findings (hides the
// noisier 'medium' ones like innerHTML/document.write), 'strict' shows
// everything - the scanner's own original, unfiltered behavior.
const securityFindings = computed(() => {
  if (!props.file || isDiffMode.value) return []
  const sensitivity = getSettings().securityScannerSensitivity || 'moderate'
  if (sensitivity === 'disabled') return []
  const findings = scanForVulnerabilities(props.file.content)
  return sensitivity === 'moderate' ? findings.filter((f) => f.severity === 'high') : findings
})

const findingsByLine = computed(() => {
  const map = new Map()
  for (const finding of securityFindings.value) {
    if (!map.has(finding.line)) map.set(finding.line, [])
    map.get(finding.line).push(finding)
  }
  return map
})

const showSecurityPanel = ref(false)
watch(() => props.file?.relPath, () => { showSecurityPanel.value = false })

// ===== Smart Code Action Menu (#11) - right-click in the plain file view =====
const contextMenu = ref(null) // { x, y, startLine, endLine, snippet } | null

function closeContextMenu() {
  contextMenu.value = null
}

/**
 * Reuses whatever's already selected (see handleCodeSelection above) if the
 * right-click happened inside that selection; otherwise falls back to just
 * the single line under the cursor, so the menu is never left with nothing
 * to act on.
 */
function handleContextMenu(event) {
  const container = codeViewRef.value
  if (!container) return

  if (selectionAction.value) {
    contextMenu.value = { x: event.clientX, y: event.clientY, ...selectionAction.value }
    return
  }

  const row = event.target.closest?.('tr[data-line]')
  if (!row) return
  const line = Number(row.dataset.line)
  const text = highlightedLines.value.length ? props.file.content.split('\n')[line - 1] || '' : ''
  contextMenu.value = { x: event.clientX, y: event.clientY, startLine: line, endLine: line, snippet: text }
}

const CONTEXT_ACTION_PROMPTS = {
  ask: (ref) => `Tolong jelaskan kode pada ${ref}.`,
  test: (ref) => `Buatkan unit test untuk kode pada ${ref}.`,
  refactor: (ref) => `Refactor kode pada ${ref} agar lebih bersih dan mengikuti best practice, tanpa mengubah perilakunya.`,
}

function handleContextAction(action) {
  const menu = contextMenu.value
  closeContextMenu()
  if (!menu || !props.file) return

  addSelectionAsContext({
    relPath: props.file.relPath,
    startLine: menu.startLine,
    endLine: menu.endLine,
    snippet: menu.snippet,
  })

  const ref = menu.startLine === menu.endLine
    ? `baris ${menu.startLine} di ${props.file.relPath}`
    : `baris ${menu.startLine}-${menu.endLine} di ${props.file.relPath}`
  emit('context-action', { action, prompt: (CONTEXT_ACTION_PROMPTS[action] || CONTEXT_ACTION_PROMPTS.ask)(ref) })
}

function handleDocumentClick(event) {
  if (contextMenu.value && !event.target.closest?.('.code-context-menu')) closeContextMenu()
}

function handleDocumentKeydown(event) {
  if (event.key === 'Escape') closeContextMenu()
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
  document.addEventListener('keydown', handleDocumentKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('keydown', handleDocumentKeydown)
})

function addCurrentSelectionToContext() {
  const action = selectionAction.value
  if (!action || !props.file) return
  addSelectionAsContext({
    relPath: props.file.relPath,
    startLine: action.startLine,
    endLine: action.endLine,
    snippet: action.snippet,
  })
  clearSelectionAction()
  window.getSelection()?.removeAllRanges()
}
</script>

<template>
  <section class="editor-pane">
    <!-- Header -->
    <header class="editor-header">
      <div class="editor-title">
        <GitCompare v-if="isDiffMode" :size="14" class="editor-title-icon editor-title-icon--diff" />
        <FileCode v-else :size="14" class="editor-title-icon" />
        <span class="editor-path" :title="proposal?.filePath || file?.relPath || ''">
          {{ proposal?.filePath || file?.relPath || 'Tidak ada file terbuka' }}
        </span>
        <span v-if="isStreamingProposal" class="editor-badge editor-badge--live">
          <Loader2 :size="10" class="spin" />
          AI sedang menulis
        </span>
        <span v-else-if="isDiffMode" class="editor-badge editor-badge--diff">Usulan perubahan</span>
        <span v-else-if="file?.truncated" class="editor-badge editor-badge--warn">Dipotong</span>
        <button
          v-if="securityFindings.length"
          class="editor-badge editor-badge--danger"
          type="button"
          :title="`${securityFindings.length} potensi masalah keamanan ditemukan - klik untuk lihat detail`"
          @click="showSecurityPanel = !showSecurityPanel"
        >
          <ShieldAlert :size="11" />
          {{ securityFindings.length }}
        </button>
      </div>

      <div class="editor-actions">
        <!-- Diff review controls -->
        <template v-if="isDiffMode">
          <span v-if="diffResult" class="diff-stats">
            <span class="diff-stat diff-stat--add">+{{ diffResult.added }}</span>
            <span class="diff-stat diff-stat--remove">-{{ diffResult.removed }}</span>
          </span>
          <button
            class="editor-btn"
            :title="showFullDiff ? 'Tampilkan hanya bagian yang berubah' : 'Tampilkan seluruh file'"
            @click="showFullDiff = !showFullDiff"
          >
            <Eye :size="13" />
            <span>{{ showFullDiff ? 'Ringkas' : 'Seluruh file' }}</span>
          </button>

          <!-- The decision, right on the change itself -->
          <span class="editor-decision-label">Terapkan perubahan ini?</span>
          <button
            class="editor-btn editor-btn--no"
            title="Tidak - buang usulan ini, file tidak diubah"
            @click="emit('reject')"
          >
            <X :size="13" />
            <span>Tidak</span>
          </button>
          <button
            class="editor-btn editor-btn--yes"
            :class="{ 'editor-btn--danger': destructiveWarning }"
            :disabled="isApplying || isStreamingProposal"
            :title="isStreamingProposal
              ? 'Tunggu sampai AI selesai menulis'
              : (destructiveWarning || 'Ya - tulis perubahan ini ke file di disk')"
            @click="destructiveWarning ? (confirmingDestructive = true) : emit('accept')"
          >
            <Loader2 v-if="isApplying" :size="13" class="spin" />
            <AlertTriangle v-else-if="destructiveWarning" :size="13" />
            <Check v-else :size="13" />
            <span>{{ isApplying ? 'Menerapkan...' : (destructiveWarning ? 'Ya, tapi...' : 'Ya') }}</span>
          </button>
        </template>

        <button v-else-if="file" class="editor-btn" title="Tutup file" @click="emit('close-file')">
          <X :size="13" />
        </button>
      </div>
    </header>

    <!-- Security & Vulnerability Scanner findings (#9) -->
    <div v-if="showSecurityPanel && securityFindings.length" class="security-panel">
      <div v-for="(finding, index) in securityFindings" :key="index" class="security-finding" :class="`security-finding--${finding.severity}`">
        <ShieldAlert :size="12" />
        <span class="security-finding-line">L{{ finding.line }}</span>
        <span class="security-finding-message">{{ finding.message }}</span>
      </div>
    </div>

    <!-- Body -->
    <div ref="diffBodyRef" class="editor-body" @scroll="handleDiffScroll">
      <div v-if="errorMessage" class="editor-message editor-message--error">
        <AlertTriangle :size="15" />
        <span>{{ errorMessage }}</span>
      </div>

      <div v-else-if="isLoading" class="editor-message">
        <Loader2 :size="15" class="spin" />
        <span>Memuat file...</span>
      </div>

      <!-- Diff view -->
      <div v-else-if="isDiffMode" class="diff-view">
        <p v-if="diffResult?.approximate" class="diff-note">
          File terlalu besar untuk dibandingkan baris per baris - bagian yang berubah ditampilkan sebagai blok pengganti.
        </p>
        <!-- Suppressed mid-stream: a half-written block legitimately has no
             differences yet, and flashing this on every token is just noise. -->
        <p
          v-if="!isStreamingProposal && diffResult && diffResult.added === 0 && diffResult.removed === 0"
          class="diff-note"
        >
          Tidak ada perbedaan dengan isi file saat ini.
        </p>
        <div v-if="destructiveWarning" class="diff-warning-banner">
          <AlertTriangle :size="15" class="diff-warning-icon" />
          <div class="diff-warning-body">
            <p class="diff-warning-text">{{ destructiveWarning }}</p>
            <div v-if="confirmingDestructive" class="diff-warning-actions">
              <span>Tetap terapkan perubahan ini ke file?</span>
              <button class="editor-btn" @click="confirmingDestructive = false">Batal</button>
              <button class="editor-btn editor-btn--danger" @click="confirmDestructiveAccept">
                <Check :size="12" /><span>Ya, tetap terapkan</span>
              </button>
            </div>
          </div>
        </div>
        <table class="diff-table">
          <tbody>
            <tr
              v-for="(row, index) in diffRows"
              :key="`${row.type}-${index}`"
              class="diff-row"
              :class="`diff-row--${row.type}`"
            >
              <td class="diff-gutter">{{ row.oldLine ?? '' }}</td>
              <td class="diff-gutter">{{ row.newLine ?? '' }}</td>
              <td class="diff-marker">
                <template v-if="row.type === 'add'">+</template>
                <template v-else-if="row.type === 'remove'">-</template>
              </td>
              <td class="diff-code">
                <span v-if="row.type === 'gap'" class="diff-gap-text">⋯ {{ row.text }}</span>
                <template v-else>{{ row.text || ' ' }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Plain file view -->
      <div
        v-else-if="file"
        ref="codeViewRef"
        class="code-view"
        @mouseup="handleCodeSelection"
        @contextmenu.prevent="handleContextMenu"
      >
        <table class="code-table">
          <tbody>
            <tr
              v-for="(line, index) in highlightedLines"
              :key="index"
              class="code-row"
              :class="{ 'code-row--flagged': findingsByLine.has(index + 1) }"
              :data-line="index + 1"
            >
              <td class="code-gutter">
                <ShieldAlert
                  v-if="findingsByLine.has(index + 1)"
                  :size="11"
                  class="code-gutter-flag"
                  :title="findingsByLine.get(index + 1).map((f) => f.message).join('\n')"
                />
                {{ index + 1 }}
              </td>
              <!-- eslint-disable-next-line vue/no-v-html -- hljs output, built from file text that was escaped first -->
              <td class="code-line hljs" v-html="line || ' '"></td>
            </tr>
          </tbody>
        </table>

        <button
          v-if="selectionAction"
          class="selection-context-btn"
          :style="{ top: `${selectionAction.top}px`, left: `${selectionAction.left}px` }"
          @click="addCurrentSelectionToContext"
        >
          <ListPlus :size="12" />
          <span>Tambah ke context ({{ selectionAction.startLine === selectionAction.endLine ? `baris ${selectionAction.startLine}` : `baris ${selectionAction.startLine}-${selectionAction.endLine}` }})</span>
        </button>

        <!-- Smart Code Action Menu (#11) -->
        <div
          v-if="contextMenu"
          class="code-context-menu glass"
          :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        >
          <button class="code-context-menu-item" type="button" @click="handleContextAction('ask')">
            <CircleQuestionMark :size="13" /><span>Tanya AI soal baris ini</span>
          </button>
          <button class="code-context-menu-item" type="button" @click="handleContextAction('test')">
            <FlaskConical :size="13" /><span>Generate Test</span>
          </button>
          <button class="code-context-menu-item" type="button" @click="handleContextAction('refactor')">
            <Wand2 :size="13" /><span>Refactor</span>
          </button>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="editor-empty">
        <FileCode :size="30" />
        <p class="editor-empty-title">Belum ada file yang dibuka</p>
        <p class="editor-empty-hint">
          Pilih file dari daftar di kiri, atau minta AI di panel kanan - klik <strong>Diff View</strong>
          pada blok kode jawabannya untuk melihat perbandingan di sini.
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.editor-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--color-bg-primary);
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  min-height: 42px;
  flex-shrink: 0;
}

.editor-title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.editor-title-icon {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.editor-title-icon--diff {
  color: #f59e0b;
}

.editor-path {
  font-family: var(--font-mono);
  font-size: 0.76rem;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-badge {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 20px;
  font-size: 0.64rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.editor-badge--diff {
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.4);
  color: #f59e0b;
}

.editor-badge--warn {
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.35);
  color: var(--color-danger);
}

.editor-badge--danger {
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.35);
  color: var(--color-danger);
  cursor: pointer;
  padding: 3px 8px;
}

.editor-badge--danger:hover {
  background: rgba(239, 68, 68, 0.2);
}

/* ===== Security & Vulnerability Scanner (#9) ===== */
.security-panel {
  max-height: 160px;
  overflow-y: auto;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-tertiary);
  flex-shrink: 0;
}

.security-finding {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 6px 12px;
  font-size: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.security-finding:last-child {
  border-bottom: none;
}

.security-finding--high {
  color: var(--color-danger, #ef4444);
}

.security-finding--medium {
  color: #f59e0b;
}

.security-finding-line {
  font-family: var(--font-mono);
  font-weight: 600;
  flex-shrink: 0;
}

.security-finding-message {
  color: var(--color-text-secondary);
}

.code-row--flagged .code-gutter {
  background: rgba(239, 68, 68, 0.08);
}

.code-gutter-flag {
  color: var(--color-danger, #ef4444);
  vertical-align: middle;
  margin-right: 3px;
  cursor: help;
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.diff-stats {
  display: flex;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 700;
}

.diff-stat--add { color: var(--color-success); }
.diff-stat--remove { color: var(--color-danger); }

.editor-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  font-family: var(--font-sans);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
  white-space: nowrap;
}

.editor-btn:hover:not(:disabled) {
  color: var(--color-text-primary);
  border-color: var(--color-border-light);
}

.editor-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* The decision pair, sitting on the change itself. */
.editor-decision-label {
  margin-left: 4px;
  color: var(--color-text-muted);
  font-size: 0.72rem;
  white-space: nowrap;
}

.editor-btn--yes {
  background: rgba(34, 197, 94, 0.14);
  border-color: rgba(34, 197, 94, 0.5);
  color: var(--color-success);
  font-weight: 700;
}

.editor-btn--yes:hover:not(:disabled) {
  background: var(--color-success);
  color: #fff;
}

.editor-btn--no {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.4);
  color: var(--color-danger);
  font-weight: 700;
}

.editor-btn--no:hover:not(:disabled) {
  background: var(--color-danger);
  color: #fff;
}

/* A likely destructive rewrite: "Ya" turns into a warning colour instead of
   the usual green, so it doesn't read as a routine, safe confirmation. */
.editor-btn--danger {
  background: rgba(245, 158, 11, 0.16) !important;
  border-color: rgba(245, 158, 11, 0.55) !important;
  color: #f59e0b !important;
}

.editor-btn--danger:hover:not(:disabled) {
  background: #f59e0b !important;
  color: #fff !important;
}

.diff-warning-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}

.diff-warning-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.diff-warning-body {
  flex: 1;
  min-width: 0;
}

.diff-warning-text {
  margin: 0;
  font-size: 0.76rem;
  line-height: 1.55;
  color: #f59e0b;
}

.diff-warning-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 0.74rem;
  color: var(--color-text-secondary);
}

/* Pulses while the model is still writing the change into this pane. */
.editor-badge--live {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(139, 92, 246, 0.15);
  border: 1px solid rgba(139, 92, 246, 0.45);
  color: var(--color-text-accent);
  animation: editor-live-pulse 1.6s ease-in-out infinite;
}

@keyframes editor-live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.editor-body {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.code-view {
  position: relative;
}

/* Appears near a text selection made in the plain file view (see
   handleCodeSelection) - lets the user hand the AI exactly the lines that
   matter instead of the whole file. */
.selection-context-btn {
  position: absolute;
  transform: translateY(-100%);
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--color-accent);
  border-radius: 7px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-accent);
  font-family: var(--font-sans);
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  z-index: 5;
  animation: selectionBtnIn 0.12s ease;
}

.selection-context-btn:hover {
  background: var(--color-accent);
  color: var(--color-on-accent, white);
}

@keyframes selectionBtnIn {
  from { opacity: 0; transform: translateY(-100%) scale(0.92); }
  to { opacity: 1; transform: translateY(-100%) scale(1); }
}

/* ===== Smart Code Action Menu (#11) ===== */
.code-context-menu {
  position: fixed;
  min-width: 190px;
  padding: 4px;
  border-radius: 9px;
  z-index: 150;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.code-context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.78rem;
  font-family: var(--font-sans);
  text-align: left;
  border-radius: 6px;
  cursor: pointer;
}

.code-context-menu-item:hover {
  background: var(--color-accent-subtle);
  color: var(--color-text-accent);
}

/* ===== Shared code/diff table ===== */
.code-table,
.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 0.74rem;
  line-height: 1.55;
}

.code-gutter,
.diff-gutter {
  width: 1%;
  padding: 0 8px;
  text-align: right;
  color: var(--color-text-muted);
  background: var(--color-bg-secondary);
  border-right: 1px solid var(--color-border);
  user-select: none;
  vertical-align: top;
  white-space: nowrap;
}

.code-line,
.diff-code {
  padding: 0 12px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-text-primary);
  vertical-align: top;
}

.code-line :deep(.hljs-keyword),
.code-line :deep(.hljs-built_in) { color: #c084fc; }
.code-line :deep(.hljs-string) { color: #86efac; }
.code-line :deep(.hljs-comment) { color: var(--color-text-muted); font-style: italic; }
.code-line :deep(.hljs-number) { color: #fbbf24; }
.code-line :deep(.hljs-title),
.code-line :deep(.hljs-function) { color: #60a5fa; }
.code-line :deep(.hljs-attr),
.code-line :deep(.hljs-property) { color: #f472b6; }

.diff-marker {
  width: 1%;
  padding: 0 4px;
  text-align: center;
  font-weight: 700;
  user-select: none;
  vertical-align: top;
}

.diff-row--add { background: rgba(34, 197, 94, 0.12); }
.diff-row--add .diff-marker,
.diff-row--add .diff-code { color: #86efac; }

.diff-row--remove { background: rgba(239, 68, 68, 0.12); }
.diff-row--remove .diff-marker,
.diff-row--remove .diff-code { color: #fca5a5; }

.diff-row--gap { background: var(--color-bg-secondary); }

.diff-gap-text {
  color: var(--color-text-muted);
  font-style: italic;
  font-size: 0.7rem;
}

.diff-note {
  margin: 0;
  padding: 8px 12px;
  background: rgba(245, 158, 11, 0.1);
  border-bottom: 1px solid var(--color-border);
  color: #f59e0b;
  font-size: 0.72rem;
}

/* ===== States ===== */
.editor-message {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: var(--color-text-secondary);
  font-size: 0.78rem;
}

.editor-message--error {
  color: var(--color-danger);
}

.editor-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  padding: 32px 24px;
  color: var(--color-text-muted);
  text-align: center;
}

.editor-empty-title {
  margin: 0;
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.editor-empty-hint {
  margin: 0;
  max-width: 380px;
  font-size: 0.75rem;
  line-height: 1.6;
}

.spin {
  animation: editor-spin 1s linear infinite;
}

@keyframes editor-spin {
  to { transform: rotate(360deg); }
}
</style>
