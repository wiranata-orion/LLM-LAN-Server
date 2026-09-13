import { reactive, ref } from 'vue'
import {
  getWorkspaceStatus,
  openWorkspace,
  closeWorkspace,
  reindexWorkspace,
  listWorkspaceFiles,
  readWorkspaceFile,
  applyWorkspaceChanges,
  sendWorkspaceChat,
} from './workspace.ts'

/**
 * Single shared source of truth for Vibe Coding state.
 *
 * The project's file tree now lives in the sidebar (so Workspace mode replaces
 * the conversation folder list there) while the editor and AI chat panel live
 * in the main content area (WorkspaceView.vue) - two different components that
 * both need to react to the same "which file is open", "what did the last
 * apply touch", and "is the index still running" state. A plain reactive
 * module singleton is simpler than prop-drilling all of this through App.vue,
 * which doesn't otherwise need to know anything about Vibe Coding.
 */

export const status = ref({
  isOpen: false,
  state: 'empty',
  totalFiles: 0,
  indexedFiles: 0,
  chunkCount: 0,
  workspaceRoot: null,
  currentFile: null,
  watching: false,
  error: null,
})

export const files = ref([]) // flat path list, for the "@" chat autocomplete
// Bumped whenever the tree's contents might have changed (opened a project,
// indexing finished, a file was created/overwritten). WorkspaceFileTree.vue
// watches this instead of a parent holding a direct component ref, since the
// tree (in the sidebar) and the actions that change it (in the main content
// area) are no longer siblings under the same parent.
export const treeVersion = ref(0)

export const openFile = ref(null)
export const isFileLoading = ref(false)
export const editorError = ref('')
export const proposal = ref(null)
export const applyingPath = ref('')

export const messages = ref([])
export const isGenerating = ref(false)
export const chatError = ref('')

export const showFolderBrowser = ref(false)

export const toast = ref(null)
let toastTimer = null
export function showToast(message, tone = 'success') {
  toast.value = { message, tone }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, 6000)
}

let abortController = null
let statusTimer = null
let pollersActive = 0

async function loadFileList() {
  try {
    const result = await listWorkspaceFiles()
    files.value = result.files || []
  } catch {
    files.value = []
  }
}

async function refreshStatus() {
  try {
    const next = await getWorkspaceStatus()
    const wasIndexing = status.value.state === 'indexing'
    status.value = next
    if (wasIndexing && next.state !== 'indexing') {
      await loadFileList()
      treeVersion.value += 1
    }
  } catch (error) {
    status.value = { ...status.value, error: error instanceof Error ? error.message : 'Agent server tidak terhubung' }
  } finally {
    if (pollersActive > 0) scheduleStatusPoll()
  }
}

function scheduleStatusPoll() {
  if (statusTimer) clearTimeout(statusTimer)
  const isIndexing = status.value.state === 'indexing'
  statusTimer = setTimeout(refreshStatus, isIndexing ? 1200 : 10000)
}

/**
 * Multiple components (the sidebar, the main workspace view) mount and unmount
 * as the app switches modes; the poll loop itself should only really run once.
 * Each caller registers interest with startStatusPolling()/stopStatusPolling()
 * in onMounted/onUnmounted, and the loop keeps going as long as anyone needs it.
 */
export function startStatusPolling() {
  pollersActive += 1
  if (pollersActive === 1) refreshStatus()
}

export function stopStatusPolling() {
  pollersActive = Math.max(0, pollersActive - 1)
  if (pollersActive === 0 && statusTimer) {
    clearTimeout(statusTimer)
    statusTimer = null
  }
}

export async function initWorkspace() {
  const next = await getWorkspaceStatus()
  status.value = next
  if (next.isOpen) await loadFileList()
  return next
}

export async function openProjectFolder(path) {
  showFolderBrowser.value = false
  try {
    status.value = await openWorkspace(path)
    openFile.value = null
    proposal.value = null
    messages.value = []
    await loadFileList()
    treeVersion.value += 1
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal membuka folder proyek'
    return { ok: false, error: message }
  }
}

export async function closeProjectFolder() {
  try {
    status.value = await closeWorkspace()
    openFile.value = null
    proposal.value = null
    messages.value = []
    files.value = []
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Gagal menutup workspace', 'error')
  }
}

export async function reindexProject() {
  try {
    status.value = await reindexWorkspace()
    showToast('Index ulang dimulai.')
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Gagal mengindeks ulang', 'error')
  }
}

export async function openWorkspaceFile(relPath) {
  isFileLoading.value = true
  editorError.value = ''
  proposal.value = null
  try {
    openFile.value = await readWorkspaceFile(relPath)
  } catch (error) {
    openFile.value = null
    editorError.value = error instanceof Error ? error.message : 'Gagal membaca file'
  } finally {
    isFileLoading.value = false
  }
}

export function closeWorkspaceFile() {
  openFile.value = null
  proposal.value = null
}

/** "Diff View" on a code block: load the current file, then show the comparison. */
export async function requestDiff({ filePath, newContent }) {
  if (!openFile.value || openFile.value.relPath !== filePath) {
    isFileLoading.value = true
    editorError.value = ''
    try {
      openFile.value = await readWorkspaceFile(filePath)
    } catch {
      // A file the model wants to create doesn't exist yet - diff against empty.
      openFile.value = { relPath: filePath, content: '', lines: 0, truncated: false, size: 0, indexable: true }
    } finally {
      isFileLoading.value = false
    }
  }
  proposal.value = { filePath, newContent }
}

/**
 * Writes a proposed block to disk. When the file being written is the one on
 * screen, its currently-shown content goes along as `expectedContent`, so the
 * server can refuse the write if the file changed after the diff was reviewed.
 */
export async function applyProposedChange({ filePath, newContent }) {
  applyingPath.value = filePath
  try {
    const baseline = openFile.value && openFile.value.relPath === filePath && proposal.value
      ? openFile.value.content
      : undefined

    const result = await applyWorkspaceChanges(filePath, newContent, baseline)

    proposal.value = null
    if (openFile.value?.relPath === filePath || !openFile.value) {
      await openWorkspaceFile(filePath)
    }
    treeVersion.value += 1
    await loadFileList()

    showToast(
      result.created
        ? `File baru dibuat: ${result.filePath}`
        : `${result.filePath} diperbarui. Backup: ${result.backupPath || 'tidak ada'}`,
    )
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Gagal menulis file', 'error')
  } finally {
    applyingPath.value = ''
  }
}

export async function sendChatPrompt(prompt, { selectedModel } = {}) {
  if (isGenerating.value) return
  chatError.value = ''

  messages.value.push({ role: 'user', content: prompt })
  const assistantIndex = messages.value.push({ role: 'assistant', content: '', contextBlocks: [] }) - 1

  isGenerating.value = true
  abortController = new AbortController()

  const history = messages.value
    .slice(0, -2)
    .slice(-6)
    .map((message) => ({ role: message.role, content: message.content }))

  try {
    await sendWorkspaceChat(prompt, {
      model: selectedModel || undefined,
      targetPath: openFile.value?.relPath || undefined,
      history,
      signal: abortController.signal,
      handlers: {
        onContext: (payload) => {
          messages.value[assistantIndex].contextBlocks = payload.blocks
          if (payload.budgetExceeded) {
            messages.value[assistantIndex].contextNote = 'Sebagian context dipotong agar muat di context window.'
          }
        },
        onToken: (token) => {
          messages.value[assistantIndex].content += token
        },
      },
    })
  } catch (error) {
    if (!abortController?.signal.aborted) {
      chatError.value = error instanceof Error ? error.message : 'Permintaan gagal'
    }
  } finally {
    isGenerating.value = false
    abortController = null
  }
}

export function stopChatGeneration() {
  abortController?.abort()
  isGenerating.value = false
}
