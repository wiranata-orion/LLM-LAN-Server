import { computed, reactive, ref } from 'vue'
import {
  getWorkspaceStatus,
  openWorkspace,
  closeWorkspace,
  reindexWorkspace,
  listWorkspaceFiles,
  readWorkspaceFile,
  applyWorkspaceChanges,
  sendWorkspaceChat,
  listWorkspaceChats,
  getWorkspaceChat,
  saveWorkspaceChat,
  deleteWorkspaceChat,
} from './workspace.ts'
import { parseWorkspaceReplySegments, deriveFallbackFilePath } from './workspaceChatParsing.js'

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

// ===== AI Coding Assistant: saved chat sessions, scoped per project =====
// Mirrors Conversation mode's chat list, but for the workspace chat: a list
// the user can pick from, persisted server-side under the open project (see
// workspace-store.ts's workspace_chats table) rather than kept only in memory.
export const chatSessions = ref([]) // summaries: { id, title, createdAt, updatedAt, messageCount }
export const activeChatId = ref(null)
export const isChatHistoryLoading = ref(false)

/**
 * Per-code-block accept/reject state, keyed by "<messageIndex>:<segmentIndex>".
 * A `reactive` Map (not a `ref`) because Vue 3 proxies Map/Set natively, so
 * `.get()`/`.set()` inside a computed or template track and trigger exactly
 * like plain object properties would.
 */
export const changeDecisions = reactive(new Map())

function decisionKey(messageIndex, segmentIndex) {
  return `${messageIndex}:${segmentIndex}`
}

export function getChangeDecision(messageIndex, segmentIndex) {
  return changeDecisions.get(decisionKey(messageIndex, segmentIndex)) || null
}

/**
 * Every file with at least one proposed change nobody has accepted or
 * rejected yet, across the whole conversation - drives the pending-change dot
 * shown next to that file in the sidebar's file tree (see WorkspaceFileTree.vue).
 * Recomputed from the messages themselves (via the same parser the chat panel
 * renders with) rather than tracked separately, so it can never drift out of
 * sync with what is actually on screen.
 */
export const pendingFilePaths = computed(() => {
  const paths = new Set()
  messages.value.forEach((message, messageIndex) => {
    if (message.role !== 'assistant') return
    const fallbackFilePath = deriveFallbackFilePath(message.contextBlocks)
    const segments = parseWorkspaceReplySegments(message.content || '', { fallbackFilePath })
    segments.forEach((segment, segmentIndex) => {
      if (segment.kind !== 'code' || !segment.filePath || !segment.closed) return
      if (!getChangeDecision(messageIndex, segmentIndex)) paths.add(segment.filePath)
    })
  })
  return paths
})

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
  if (next.isOpen) {
    await loadFileList()
    await loadChatSessions()
  }
  return next
}

export async function openProjectFolder(path) {
  showFolderBrowser.value = false
  try {
    status.value = await openWorkspace(path)
    openFile.value = null
    proposal.value = null
    resetActiveChat()
    await loadFileList()
    await loadChatSessions()
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
    resetActiveChat()
    files.value = []
    chatSessions.value = []
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
export async function requestDiff({ filePath, newContent, messageIndex, segmentIndex }) {
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
  proposal.value = { filePath, newContent, streaming: false, messageIndex, segmentIndex }
}

/**
 * Loads a file to diff against without disturbing the proposal already on
 * screen - openWorkspaceFile() clears `proposal`, which would wipe out the
 * live diff the moment its baseline finished loading.
 */
async function ensureDiffBaseline(filePath) {
  if (openFile.value?.relPath === filePath) return
  try {
    openFile.value = await readWorkspaceFile(filePath)
  } catch {
    // A file the model is creating doesn't exist yet - diff against empty.
    openFile.value = { relPath: filePath, content: '', lines: 0, truncated: false, size: 0, indexable: true }
  }
}

// ===== Live diff while the reply streams =====
// Rather than leaving a wall of code in the chat column for the user to read,
// the proposed file is mirrored into the editor pane as a diff *as it is being
// written*, with the Ya/Tidak decision offered right there. Parsing on every
// single token would be wasteful on a long file, so it is throttled.
const LIVE_DIFF_THROTTLE_MS = 150
let liveDiffPath = null
let lastLiveDiffAt = 0

function updateLiveProposal(messageIndex, { force = false } = {}) {
  const now = Date.now()
  if (!force && now - lastLiveDiffAt < LIVE_DIFF_THROTTLE_MS) return
  lastLiveDiffAt = now

  const message = messages.value[messageIndex]
  if (!message) return

  const fallbackFilePath = deriveFallbackFilePath(message.contextBlocks)
  const segments = parseWorkspaceReplySegments(message.content || '', { fallbackFilePath })

  // The LAST targeted block is the one currently being written - a reply that
  // touches several files should follow along to whichever is in progress.
  let segmentIndex = -1
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (segment.kind === 'code' && segment.filePath) {
      segmentIndex = index
      break
    }
  }
  if (segmentIndex === -1) return

  const segment = segments[segmentIndex]
  // Wait until the block has a body. Mid-stream the opening fence itself
  // arrives character by character, so "```apache:.ht" briefly parses as a
  // complete label for a file named ".ht" - which then fires a doomed request
  // for a file that doesn't exist. A segment only has content once the fence
  // line was terminated by a newline, which means its label is final.
  if (!segment.content) return
  // A decision already made for this block shouldn't be re-opened mid-stream.
  if (getChangeDecision(messageIndex, segmentIndex)) return

  if (liveDiffPath !== segment.filePath) {
    liveDiffPath = segment.filePath
    void ensureDiffBaseline(segment.filePath)
  }

  proposal.value = {
    filePath: segment.filePath,
    newContent: segment.content,
    streaming: !segment.closed,
    messageIndex,
    segmentIndex,
  }
}

/**
 * Writes a proposed block to disk. When the file being written is the one on
 * screen, its currently-shown content goes along as `expectedContent`, so the
 * server can refuse the write if the file changed after the diff was reviewed.
 */
/** @returns {Promise<boolean>} whether the write actually succeeded - callers that record an "accepted" decision must check this rather than assume success. */
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
    return true
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Gagal menulis file', 'error')
    return false
  } finally {
    applyingPath.value = ''
  }
}

export async function sendChatPrompt(prompt, { selectedModel } = {}) {
  if (isGenerating.value) return
  chatError.value = ''

  messages.value.push({ role: 'user', content: prompt })
  const assistantIndex = messages.value.push({ role: 'assistant', content: '', contextBlocks: [] }) - 1
  // Fire-and-forget: the user's turn is worth saving immediately, in case the
  // tab closes before the reply finishes (mirrors Conversation mode's own
  // "save right after the user message" behaviour).
  persistActiveChat()

  isGenerating.value = true
  abortController = new AbortController()
  // Each turn starts its own live diff; forget which file the previous one was
  // mirroring so a new target reloads its baseline.
  liveDiffPath = null
  lastLiveDiffAt = 0

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
          // Mirror the change into the editor as a live diff while it writes.
          updateLiveProposal(assistantIndex)
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
    // Final pass, unthrottled: picks up the closing fence so the diff stops
    // reporting itself as still streaming and the Ya button becomes usable.
    updateLiveProposal(assistantIndex, { force: true })
    await persistActiveChat()
  }
}

export function stopChatGeneration() {
  abortController?.abort()
  isGenerating.value = false
}

// ===== Chat session history (save / list / switch / delete) =====

function generateChatId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** First user message, trimmed, doubles as the session's title - same rule Conversation mode uses. */
function deriveChatTitle(msgs) {
  const firstUser = msgs.find((message) => message.role === 'user')
  if (!firstUser?.content) return 'Chat baru'
  const text = firstUser.content.trim().replace(/\s+/g, ' ')
  if (!text) return 'Chat baru'
  return text.length > 50 ? `${text.slice(0, 50)}...` : text
}

function resetActiveChat() {
  activeChatId.value = null
  messages.value = []
  changeDecisions.clear()
}

export async function loadChatSessions() {
  if (!status.value.isOpen) {
    chatSessions.value = []
    return
  }
  try {
    const result = await listWorkspaceChats()
    chatSessions.value = result.chats || []
  } catch {
    chatSessions.value = []
  }
}

/** Starts a fresh, unsaved chat - nothing is written until the first message is sent. */
export function startNewChat() {
  resetActiveChat()
}

export async function selectChatSession(id) {
  if (id === activeChatId.value) return
  isChatHistoryLoading.value = true
  try {
    const result = await getWorkspaceChat(id)
    activeChatId.value = id
    messages.value = result.chat.messages || []
    changeDecisions.clear()
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Gagal memuat chat', 'error')
  } finally {
    isChatHistoryLoading.value = false
  }
}

export async function deleteChatSessionById(id) {
  try {
    await deleteWorkspaceChat(id)
    chatSessions.value = chatSessions.value.filter((session) => session.id !== id)
    if (activeChatId.value === id) resetActiveChat()
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Gagal menghapus chat', 'error')
  }
}

/** Upserts the current message list under the active session, creating one on first save. */
async function persistActiveChat() {
  if (!status.value.isOpen || !messages.value.length) return
  const id = activeChatId.value || generateChatId()
  activeChatId.value = id
  try {
    const result = await saveWorkspaceChat(id, deriveChatTitle(messages.value), messages.value)
    const index = chatSessions.value.findIndex((session) => session.id === id)
    if (index >= 0) chatSessions.value[index] = result.chat
    else chatSessions.value.unshift(result.chat)
    chatSessions.value.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
  } catch (error) {
    console.warn('Failed to save workspace chat session:', error)
  }
}

// ===== Accept / reject a proposed change =====
// Every labelled code block in a reply is a pending change until the user
// explicitly decides on it (see pendingFilePaths above, which drives the file
// tree's indicator) - "Diff View" alone never counted as a decision.

/**
 * Accepting writes the block to disk (same as the old single "Apply Changes"
 * button) and records the decision - but only when the write actually
 * succeeded. Marking it "accepted" on a failed write would tell the file
 * tree's pending indicator to clear even though nothing was really written,
 * silently hiding a change that still needs attention.
 */
export async function acceptChange({ messageIndex, segmentIndex, filePath, newContent }) {
  const wrote = await applyProposedChange({ filePath, newContent })
  if (wrote) changeDecisions.set(decisionKey(messageIndex, segmentIndex), 'accepted')
}

/** Rejecting just records the decision - nothing is written, and the file stops showing as pending. */
export function rejectChange({ messageIndex, segmentIndex }) {
  changeDecisions.set(decisionKey(messageIndex, segmentIndex), 'rejected')
  // Clear the editor if it is showing this exact block, so a rejected change
  // doesn't linger on screen as if it were still awaiting a decision.
  const current = proposal.value
  if (current && current.messageIndex === messageIndex && current.segmentIndex === segmentIndex) {
    proposal.value = null
  }
}

/** Undoes a rejection, putting the block back to pending for review. */
export function clearChangeDecision(messageIndex, segmentIndex) {
  changeDecisions.delete(decisionKey(messageIndex, segmentIndex))
}

/**
 * "Ya" in the editor's diff bar. Same effect as accepting from the chat, but
 * driven by whatever the editor is currently showing - the proposal carries
 * the message/segment it came from so the chat card and the file tree's
 * pending dot stay in step with the decision made here.
 */
export async function acceptCurrentProposal() {
  const current = proposal.value
  if (!current || current.streaming) return
  if (Number.isInteger(current.messageIndex) && Number.isInteger(current.segmentIndex)) {
    await acceptChange({
      messageIndex: current.messageIndex,
      segmentIndex: current.segmentIndex,
      filePath: current.filePath,
      newContent: current.newContent,
    })
    return
  }
  await applyProposedChange({ filePath: current.filePath, newContent: current.newContent })
}

/** "Tidak" in the editor's diff bar - records the rejection and closes the diff. */
export function rejectCurrentProposal() {
  const current = proposal.value
  if (!current) return
  if (Number.isInteger(current.messageIndex) && Number.isInteger(current.segmentIndex)) {
    rejectChange({ messageIndex: current.messageIndex, segmentIndex: current.segmentIndex })
  }
  proposal.value = null
}
