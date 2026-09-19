<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  FolderOpen,
  Database,
  Eye,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  PanelRightOpen,
} from 'lucide-vue-next'
import WorkspaceEditor from './WorkspaceEditor.vue'
import WorkspaceChatPanel from './WorkspaceChatPanel.vue'
import {
  status,
  files,
  openFile,
  isFileLoading,
  editorError,
  proposal,
  applyingPath,
  messages,
  isGenerating,
  chatError,
  toast,
  showFolderBrowser,
  startStatusPolling,
  stopStatusPolling,
  closeWorkspaceFile,
  acceptCurrentProposal,
  rejectCurrentProposal,
  sendChatPrompt,
  stopChatGeneration,
} from '../services/workspaceStore.js'

// The file tree itself now lives in the sidebar (see Sidebar.vue), replacing
// the conversation folder/chat lists while in Workspace mode - this view only
// owns the editor and the AI chat panel, both fed by the shared workspaceStore
// so a file picked in the sidebar shows up here immediately.

const props = defineProps({
  selectedModel: { type: String, default: '' },
})

const indexProgress = computed(() => {
  const total = status.value.totalFiles || 0
  if (!total) return 0
  return Math.min(100, Math.round((status.value.indexedFiles / total) * 100))
})

const isIndexing = computed(() => status.value.state === 'indexing')

// ===== AI Coding Assistant panel: collapsible, and resizable by dragging its
// left edge - mirrors the same drag-to-resize pattern as the sidebar. =====
const CHAT_MIN_WIDTH = 260
const CHAT_MAX_WIDTH = 620
const DEFAULT_CHAT_WIDTH = 340

function readStoredChatWidth() {
  try {
    const stored = Number(localStorage.getItem('vibe_chat_width'))
    if (Number.isFinite(stored) && stored >= CHAT_MIN_WIDTH && stored <= CHAT_MAX_WIDTH) return stored
  } catch (e) {}
  return DEFAULT_CHAT_WIDTH
}

function readStoredChatCollapsed() {
  try {
    return localStorage.getItem('vibe_chat_collapsed') === 'true'
  } catch (e) {
    return false
  }
}

const chatWidth = ref(readStoredChatWidth())
const chatCollapsed = ref(readStoredChatCollapsed())
const isResizingChat = ref(false)
let resizeStartX = 0
let resizeStartWidth = 0

function startChatResize(event) {
  isResizingChat.value = true
  resizeStartX = event.clientX
  resizeStartWidth = chatWidth.value
  window.addEventListener('mousemove', handleChatResize)
  window.addEventListener('mouseup', stopChatResize)
  event.preventDefault()
}

function handleChatResize(event) {
  // The panel is docked on the right, so dragging left (mouse moves toward
  // the editor) should widen it.
  const delta = resizeStartX - event.clientX
  chatWidth.value = Math.min(CHAT_MAX_WIDTH, Math.max(CHAT_MIN_WIDTH, resizeStartWidth + delta))
}

function stopChatResize() {
  isResizingChat.value = false
  window.removeEventListener('mousemove', handleChatResize)
  window.removeEventListener('mouseup', stopChatResize)
  try {
    localStorage.setItem('vibe_chat_width', String(chatWidth.value))
  } catch (e) {}
}

function collapseChat() {
  chatCollapsed.value = true
  try { localStorage.setItem('vibe_chat_collapsed', 'true') } catch (e) {}
}

function expandChat() {
  chatCollapsed.value = false
  try { localStorage.setItem('vibe_chat_collapsed', 'false') } catch (e) {}
}

function handleSend(prompt) {
  sendChatPrompt(prompt, { selectedModel: props.selectedModel })
}

onMounted(() => {
  startStatusPolling()
})

onUnmounted(() => {
  stopStatusPolling()
  window.removeEventListener('mousemove', handleChatResize)
  window.removeEventListener('mouseup', stopChatResize)
})
</script>

<template>
  <div class="workspace">
    <!-- ===== No project open yet ===== -->
    <div v-if="!status.isOpen" class="ws-setup">
      <div class="ws-setup-card glass">
        <FolderOpen :size="34" class="ws-setup-icon" />
        <h2 class="ws-setup-title">Belum Ada Folder Proyek</h2>
        <p class="ws-setup-text">
          Buka folder proyek dari panel <strong>Workspace</strong> di sidebar kiri, atau lewat tombol di bawah ini.
          Isinya akan dipindai, dipotong per fungsi, lalu di-embed ke index lokal supaya AI bisa menjawab
          berdasarkan kode yang benar-benar ada - bukan tebakan.
        </p>
        <p class="ws-setup-note">
          Folder <code>node_modules</code>, <code>.git</code>, <code>dist</code>, <code>build</code>,
          <code>vendor</code>, dan file rahasia seperti <code>.env</code> otomatis dilewati.
          Tambahkan <code>.vibeignore</code> di root proyek untuk aturan sendiri.
        </p>

        <button class="ws-primary-btn" @click="showFolderBrowser = true">
          <FolderOpen :size="15" />
          <span>Pilih Folder Proyek</span>
        </button>
      </div>
    </div>

    <!-- ===== Editor + AI chat (file tree lives in the sidebar) ===== -->
    <template v-else>
      <div class="ws-panes">
        <WorkspaceEditor
          class="ws-pane-editor"
          :file="openFile"
          :proposal="proposal"
          :is-applying="applyingPath === (proposal?.filePath || '')"
          :is-loading="isFileLoading"
          :error-message="editorError"
          @accept="acceptCurrentProposal"
          @reject="rejectCurrentProposal"
          @close-file="closeWorkspaceFile"
        />

        <!-- Always mounted (rather than v-if'd away) so collapsing/expanding is a
             smooth width transition instead of the panel vanishing/remounting
             instantly, and so its scroll position and in-progress input survive. -->
        <div
          v-show="!chatCollapsed"
          class="ws-chat-resize-handle"
          :class="{ 'ws-chat-resize-handle--active': isResizingChat }"
          @mousedown="startChatResize"
          title="Seret untuk mengubah lebar panel AI"
        ></div>
        <WorkspaceChatPanel
          class="ws-pane-chat"
          :class="{ 'ws-pane-chat--collapsed': chatCollapsed }"
          :style="{ width: chatCollapsed ? '0px' : chatWidth + 'px' }"
          :messages="messages"
          :is-generating="isGenerating"
          :files="files"
          :active-file-path="openFile?.relPath || ''"
          :applying-path="applyingPath"
          :error-message="chatError"
          @send="handleSend"
          @stop="stopChatGeneration"
          @collapse="collapseChat"
        />
        <button
          class="ws-chat-reopen-tab"
          :class="{ 'ws-chat-reopen-tab--visible': chatCollapsed }"
          @click="expandChat"
          title="Buka AI Coding Assistant"
          :tabindex="chatCollapsed ? 0 : -1"
        >
          <PanelRightOpen :size="16" />
        </button>
      </div>

      <!-- ===== Status bar ===== -->
      <footer class="ws-statusbar">
        <span class="ws-status-item ws-status-root" :title="status.workspaceRoot || ''">
          <FolderOpen :size="12" />
          {{ status.workspaceRoot }}
        </span>

        <span v-if="isIndexing" class="ws-status-item ws-status-item--busy">
          <Loader2 :size="12" class="spin" />
          Mengindeks {{ status.indexedFiles }}/{{ status.totalFiles }} ({{ indexProgress }}%)
          <span v-if="status.currentFile" class="ws-status-file">{{ status.currentFile }}</span>
        </span>
        <span v-else-if="status.state === 'error'" class="ws-status-item ws-status-item--error">
          <AlertCircle :size="12" />
          {{ status.error || 'Index bermasalah' }}
        </span>
        <span v-else class="ws-status-item ws-status-item--ok">
          <CheckCircle2 :size="12" />
          Index siap
        </span>

        <span class="ws-status-item" title="Jumlah potongan kode yang sudah di-embed">
          <Database :size="12" />
          {{ status.chunkCount }} chunk · {{ files.length }} file
        </span>

        <span v-if="status.watching" class="ws-status-item" title="Perubahan file di folder ini langsung diindeks ulang">
          <Eye :size="12" />
          Live
        </span>

        <!-- "Index Ulang" / "Ganti Folder" live in the sidebar's workspace
             header now (next to the project name) - having them here too was
             a duplicate control for the same actions. -->
      </footer>
    </template>

    <!-- Apply / error toast -->
    <Transition name="fade">
      <div v-if="toast" class="ws-toast glass" :class="`ws-toast--${toast.tone}`">
        <CheckCircle2 v-if="toast.tone === 'success'" :size="15" />
        <AlertCircle v-else :size="15" />
        <span class="ws-toast-text">{{ toast.message }}</span>
        <button class="ws-toast-close" @click="toast = null"><X :size="12" /></button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.workspace {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

/* ===== Setup ===== */
.ws-setup {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.ws-setup-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 520px;
  padding: 32px 28px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-bg-secondary);
  text-align: center;
}

.ws-setup-icon { color: var(--color-text-accent); }

.ws-setup-title {
  margin: 0;
  font-size: 1.05rem;
  color: var(--color-text-primary);
}

.ws-setup-text,
.ws-setup-note {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  line-height: 1.65;
}

.ws-setup-note {
  color: var(--color-text-muted);
  font-size: 0.73rem;
}

.ws-setup-note code,
.ws-setup-text code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--color-bg-input);
  font-family: var(--font-mono);
  font-size: 0.68rem;
}

.ws-primary-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding: 9px 18px;
  border: 1px solid var(--color-accent);
  border-radius: 10px;
  background: var(--color-accent-subtle);
  color: var(--color-text-accent);
  font-family: var(--font-sans);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}

.ws-primary-btn:hover {
  background: var(--color-accent);
  color: #fff;
}

/* ===== Panes ===== */
.ws-panes {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.ws-pane-editor {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.ws-pane-chat {
  flex: none;
  min-height: 0;
  overflow: hidden;
  transition: width 0.24s cubic-bezier(0.4, 0, 0.2, 1);
}

.ws-pane-chat--collapsed {
  border-left: none;
}

.ws-chat-resize-handle {
  flex-shrink: 0;
  width: 5px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.12s ease, width 0.24s cubic-bezier(0.4, 0, 0.2, 1);
}

.ws-chat-resize-handle:hover,
.ws-chat-resize-handle--active {
  background: var(--color-accent);
  opacity: 0.5;
}

.ws-chat-reopen-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 0;
  overflow: hidden;
  border: none;
  background: var(--color-bg-secondary);
  color: var(--color-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: width 0.24s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.18s ease, color 0.16s ease, background 0.16s ease, border-color 0.16s ease;
}

.ws-chat-reopen-tab--visible {
  width: 28px;
  opacity: 1;
  border-left: 1px solid var(--color-border);
}

.ws-chat-reopen-tab:hover {
  color: var(--color-text-accent);
  background: var(--color-bg-hover);
}

/* Narrow screens: chat panel can't hold a fixed px width comfortably. */
@media (max-width: 780px) {
  .ws-panes {
    flex-direction: column;
  }
  .ws-pane-chat {
    width: 100% !important;
    flex: 1;
  }
  .ws-chat-resize-handle {
    display: none;
  }
}

/* ===== Status bar ===== */
.ws-statusbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 5px 12px;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  font-size: 0.68rem;
  color: var(--color-text-muted);
  flex-shrink: 0;
  overflow-x: auto;
  white-space: nowrap;
}

.ws-status-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.ws-status-root {
  font-family: var(--font-mono);
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ws-status-item--busy { color: var(--color-text-accent); }
.ws-status-item--ok { color: var(--color-success); }
.ws-status-item--error { color: var(--color-danger); }

.ws-status-file {
  font-family: var(--font-mono);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.75;
}

/* ===== Toast ===== */
.ws-toast {
  position: absolute;
  bottom: 44px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(90%, 620px);
  padding: 9px 12px;
  border: 1px solid var(--color-border-light);
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.4);
  font-size: 0.76rem;
  z-index: 40;
}

.ws-toast--success { color: var(--color-success); }
.ws-toast--error { color: var(--color-danger); }

.ws-toast-text {
  color: var(--color-text-primary);
  word-break: break-word;
}

.ws-toast-close {
  display: flex;
  padding: 2px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.spin { animation: ws-spin 1s linear infinite; }

@keyframes ws-spin {
  to { transform: rotate(360deg); }
}

.fade-enter-active,
.fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }
</style>
