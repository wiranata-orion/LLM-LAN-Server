<script setup>
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'
import Sidebar from './components/Sidebar.vue'
import ChatView from './components/ChatView.vue'
import SettingsModal from './components/SettingsModal.vue'
import { PanelLeft, Server, Laptop, AlertCircle, X } from 'lucide-vue-next'
import { getModels, getSettings, saveSettingsToStorage } from './services/api.js'
import { sendMessageStream as sendAgentMessageStream } from './services/api.ts'
import {
  loadStoredConversations,
  deleteConversation,
  loadStoredFolders,
  saveConversation,
  saveStoredFolders,
  buildMemoryMessages,
} from './services/memory.js'

// ===== State =====
const sidebarOpen = ref(true)
const showSettings = ref(false)
const models = ref([])
const selectedModel = ref('')
const isGenerating = ref(false)
const currentEngine = ref('laptop')
const isCurrentEngineOnline = ref(null)
const fallbackToast = ref('')

// Conversation state
const folders = reactive([])
const conversations = reactive([])
const activeConversationId = ref(null)

let abortController = null

// ===== Computed =====
const activeConversation = computed(() => {
  return conversations.find((c) => c.id === activeConversationId.value)
})

const activeMessages = computed(() => {
  return activeConversation.value?.messages || []
})

function updateCurrentEngine() {
  const s = getSettings()
  currentEngine.value = s.activeEngine || 'laptop'
}

function handleEngineFallback(e) {
  updateCurrentEngine()
  fallbackToast.value = e.detail?.message || 'Beralih ke Laptop.'
  fetchModels()
  setTimeout(() => {
    fallbackToast.value = ''
  }, 5000)
}

// ===== Lifecycle =====
onMounted(async () => {
  // Load saved state
  loadState({
    includeConversations: !getSettings().storageDirName,
    includeFolders: !getSettings().storageDirName,
  })

  // Apply saved theme & engine
  const s = getSettings()
  if (s.theme) {
    document.documentElement.setAttribute('data-theme', s.theme)
  }
  updateCurrentEngine()
  window.addEventListener('engine-fallback', handleEngineFallback)

  // Fetch real models
  await fetchModels()

  const settings = getSettings()
  if (settings.storageDirName) {
    await loadSelectedDirectoryState()
  }

  // Keep the existing local-chat behavior only when physical storage is not active.
  if (!settings.storageDirName && conversations.length === 0) {
    createNewChat()
  }
})

onUnmounted(() => {
  window.removeEventListener('engine-fallback', handleEngineFallback)
})

// ===== API =====
async function fetchModels() {
  try {
    const fetched = await getModels()
    if (fetched && fetched.length > 0) {
      isCurrentEngineOnline.value = true
      models.value = fetched
        .filter((m) => {
          const name = typeof m === 'string' ? m : (m.name || '')
          return !/^nomic-embed-text(?::|$)/i.test(name)
        })
        .map((m) => {
        const name = typeof m === 'string' ? m : (m.name || '')
        const size = m.size ? `${(m.size / 1e9).toFixed(1)}GB` : ''
        return {
          name,
          desc: m.desc || size,
          size: m.size,
        }
        })
    } else {
      isCurrentEngineOnline.value = false
      models.value = []
    }
  } catch (err) {
    isCurrentEngineOnline.value = false
    models.value = []
  }

  if (models.value.length > 0) {
    const exists = models.value.some((m) => m.name === selectedModel.value)
    if (!selectedModel.value || !exists) {
      selectedModel.value = models.value[0].name
    }
  } else {
    selectedModel.value = ''
  }
}

// ===== Conversations =====
function createNewChat(folderId = null) {
  const id = 'chat-' + Date.now()
  conversations.push({
    id,
    title: '',
    messages: [],
    folderId: folderId || null,
    createdAt: new Date().toISOString(),
  })
  activeConversationId.value = id
  saveState()
}

function selectChat(id) {
  activeConversationId.value = id
  saveState()
}

function renameChat(id, newTitle) {
  const conv = conversations.find((c) => c.id === id)
  if (conv && newTitle && newTitle.trim()) {
    conv.title = newTitle.trim()
    saveConversation(conv, selectedModel.value).catch((error) => {
      console.error('Failed to persist renamed conversation:', error)
    })
    saveState()
  }
}

function deleteChat(id) {
  const idx = conversations.findIndex((c) => c.id === id)
  if (idx === -1) return

  const deletedConversation = conversations[idx]
  conversations.splice(idx, 1)
  deleteConversation(deletedConversation, selectedModel.value).catch((error) => {
    console.error('Failed to delete conversation from storage:', error)
  })

  if (activeConversationId.value === id) {
    if (conversations.length > 0) {
      activeConversationId.value = conversations[Math.max(0, idx - 1)].id
    } else {
      createNewChat()
    }
  }
  saveState()
}

// ===== Folders =====
function createFolder(name, parentId = null) {
  const id = 'folder-' + Date.now()
  folders.push({
    id,
    name: (name || 'New Folder').trim(),
    parentId: parentId || null,
    isExpanded: true,
    createdAt: new Date().toISOString(),
  })
  saveState()
  return id
}

function renameFolder(id, newName) {
  const folder = folders.find((f) => f.id === id)
  if (folder && newName && newName.trim()) {
    folder.name = newName.trim()
    saveState()
  }
}

function deleteFolder(id) {
  // Check if folder contains conversations or subfolders
  const hasChats = conversations.some((c) => c.folderId === id)
  const hasSubfolders = folders.some((f) => f.parentId === id)
  if (hasChats || hasSubfolders) {
    return false // Cannot delete non-empty folder
  }
  const idx = folders.findIndex((f) => f.id === id)
  if (idx !== -1) {
    folders.splice(idx, 1)
    saveState()
    return true
  }
  return false
}

function toggleFolderExpand(id) {
  const folder = folders.find((f) => f.id === id)
  if (folder) {
    folder.isExpanded = !folder.isExpanded
    saveState()
  }
}

function moveFolder(folderId, targetParentId) {
  if (folderId === targetParentId) return false

  // Prevent circular hierarchy (cannot move folder into one of its descendants)
  if (targetParentId) {
    let curr = folders.find((f) => f.id === targetParentId)
    while (curr) {
      if (curr.id === folderId) {
        return false // Cycle detected
      }
      curr = folders.find((f) => f.id === curr.parentId)
    }
  }

  const folder = folders.find((f) => f.id === folderId)
  if (folder) {
    folder.parentId = targetParentId || null
    saveState()
    return true
  }
  return false
}

function moveChatToFolder(chatId, targetFolderId) {
  const conv = conversations.find((c) => c.id === chatId)
  if (conv) {
    conv.folderId = targetFolderId || null
    saveConversation(conv, selectedModel.value).catch((error) => {
      console.error('Failed to persist conversation folder:', error)
    })
    saveState()
  }
}

// ===== Messaging =====


function stopGeneration() {
  if (abortController) {
    abortController.abort()
    abortController = null
    isGenerating.value = false
  }
}

// Send a user message and trigger assistant response
async function sendMessage(text) {
  if (isGenerating.value) return
  if (!activeConversation.value) createNewChat()

  // Check model
  if (!selectedModel.value) {
    activeConversation.value.messages.push({
      role: 'assistant',
      content: 'Tidak ada model yang dipilih.',
    })
    return
  }

  // Add user message
  activeConversation.value.messages.push({
    role: 'user',
    content: text,
  })

  // Set title from first message
  if (!activeConversation.value.title) {
    activeConversation.value.title = text.substring(0, 50) + (text.length > 50 ? '...' : '')
  }

  // Save immediately so retrieval cannot delay or prevent persistence of the user message.
  saveConversation(activeConversation.value, selectedModel.value).catch((error) => {
    console.error('Conversation memory initial save failed:', error)
  })

  // Generate assistant response
  generateAssistantResponse()
}

function handleRegenerate() {
  const conv = activeConversation.value
  if (!conv || isGenerating.value) return
  // Remove the last assistant message if present
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    if (conv.messages[i].role === 'assistant') {
      conv.messages.splice(i, 1)
      break
    }
  }
  // Generate new response
  generateAssistantResponse()
}

async function generateAssistantResponse() {
  const conv = activeConversation.value
  if (!conv) return
  // Add empty assistant message for streaming
  conv.messages.push({
    role: 'assistant',
    content: '',
    model: selectedModel.value,
  })
  const assistantIdx = conv.messages.length - 1
  isGenerating.value = true

  const conversationMessages = conv.messages
    .slice(0, -1)
    .map(m => ({ role: m.role, content: m.content }))

  const latestUserMessage = conversationMessages[conversationMessages.length - 1]
  const history = conversationMessages.slice(0, -1)
  const memoryMessages = latestUserMessage?.content
    ? await buildMemoryMessages({
        query: latestUserMessage.content,
        model: selectedModel.value,
      })
    : []

  abortController = new AbortController()
  try {
    await sendAgentMessageStream(
      latestUserMessage?.content || '',
      [...memoryMessages, ...history],
      selectedModel.value,
      abortController.signal,
      conv.id,
      (token) => {
        conv.messages[assistantIdx].content += token
      },
    )
  } catch (error) {
    if (!abortController.signal.aborted) {
      conv.messages[assistantIdx].content = `Error: ${error instanceof Error ? error.message : 'Agent request failed'}`
    }
  } finally {
    isGenerating.value = false
    abortController = null
    saveConversation(conv, selectedModel.value).catch((error) => {
      console.error('Conversation memory final save failed:', error)
    })
    saveState()
  }
}

// ===== Model =====
function selectModel(modelName) {
  selectedModel.value = modelName
  saveState()
}

// ===== Engine Switching =====
let engineToastTimer = null

async function toggleEngine() {
  const nextEngine = currentEngine.value === 'pc' ? 'laptop' : 'pc'
  const s = getSettings()

  if (nextEngine === 'pc' && (!s.pcUrl || !s.pcUrl.trim())) {
    fallbackToast.value = 'Alamat IP PC Server belum diatur. Buka Settings untuk mengisi IP PC Server.'
    if (engineToastTimer) clearTimeout(engineToastTimer)
    engineToastTimer = setTimeout(() => {
      fallbackToast.value = ''
    }, 4000)
    return
  }

  currentEngine.value = nextEngine
  saveSettingsToStorage({ activeEngine: nextEngine })
  isCurrentEngineOnline.value = null

  fallbackToast.value = `Beralih ke ${nextEngine === 'pc' ? 'PC Server' : 'Laptop'}...`
  if (engineToastTimer) clearTimeout(engineToastTimer)
  engineToastTimer = setTimeout(() => {
    fallbackToast.value = ''
  }, 3500)

  await fetchModels()
}

// ===== Settings =====
function openSettings() {
  showSettings.value = true
}

function closeSettings() {
  showSettings.value = false
}

async function onSettingsSave(newSettings) {
  updateCurrentEngine()
  if (newSettings?.theme) {
    document.documentElement.setAttribute('data-theme', newSettings.theme)
  }
  await fetchModels()
  if (newSettings?.storageDirName) {
    let storedConversations = []
    try {
      storedConversations = await loadStoredConversations(selectedModel.value, {
        requireConnection: false,
      }) || []
    } catch (error) {
      console.error('Failed to load conversations from the selected folder:', error)
    }
    conversations.splice(0, conversations.length, ...storedConversations)
    activeConversationId.value = conversations[0]?.id || null
  }
}

async function onFolderChanged() {
  await loadSelectedDirectoryState()
}

async function loadSelectedDirectoryState() {
  conversations.splice(0, conversations.length)
  folders.splice(0, folders.length)
  activeConversationId.value = null

  try {
    const [storedConversations, storedFolders] = await Promise.all([
      loadStoredConversations(selectedModel.value, { requireConnection: false }),
      loadStoredFolders(selectedModel.value),
    ])
    conversations.splice(0, conversations.length, ...(storedConversations || []))
    folders.splice(0, folders.length, ...(storedFolders || []))
    activeConversationId.value = conversations[0]?.id || null
  } catch (error) {
    console.error('Failed to load conversations after folder change:', error)
  }
}

function handleImportData(data) {
  if (data.folders && Array.isArray(data.folders)) {
    folders.splice(0, folders.length, ...data.folders)
  }
  if (data.conversations && Array.isArray(data.conversations)) {
    conversations.splice(0, conversations.length, ...data.conversations)
    if (conversations.length > 0) {
      activeConversationId.value = conversations[0].id
    }
  }
  saveState()
}

// ===== Sidebar =====
function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
}

// ===== Persistence =====
function saveState() {
  try {
    const state = {
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        messages: c.messages,
        folderId: c.folderId || null,
        createdAt: c.createdAt,
      })),
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId || null,
        isExpanded: f.isExpanded !== false,
        createdAt: f.createdAt,
      })),
      activeConversationId: activeConversationId.value,
      selectedModel: selectedModel.value,
    }
    localStorage.setItem('llm-chat-state', JSON.stringify(state))
    saveStoredFolders(folders, selectedModel.value).catch((error) => {
      console.error('Failed to save folders to the selected directory:', error)
    })
  } catch (e) {
    // ignore
  }
}

function loadState({ includeConversations = true, includeFolders = true } = {}) {
  try {
    const saved = localStorage.getItem('llm-chat-state')
    if (saved) {
      const state = JSON.parse(saved)
      if (includeFolders && state.folders && Array.isArray(state.folders)) {
        folders.push(
          ...state.folders.map((f) => ({
            ...f,
            parentId: f.parentId || null,
          }))
        )
      }
      if (includeConversations && state.conversations && Array.isArray(state.conversations)) {
        conversations.push(
          ...state.conversations.map((c) => ({
            ...c,
            folderId: c.folderId || null,
          }))
        )
      }
      if (state.activeConversationId) {
        activeConversationId.value = state.activeConversationId
      }
      if (state.selectedModel) {
        selectedModel.value = state.selectedModel
      }
    }
  } catch (e) {
    // ignore
  }
}
</script>

<template>
  <div class="app-layout">
    <!-- Sidebar -->
    <Sidebar
      :conversations="conversations"
      :folders="folders"
      :active-id="activeConversationId"
      :models="models"
      :selected-model="selectedModel"
      :is-open="sidebarOpen"
      @new-chat="createNewChat"
      @select-chat="selectChat"
      @delete-chat="deleteChat"
      @rename-chat="renameChat"
      @create-folder="createFolder"
      @rename-folder="renameFolder"
      @delete-folder="deleteFolder"
      @toggle-folder-expand="toggleFolderExpand"
      @move-folder="moveFolder"
      @move-chat="moveChatToFolder"
      @select-model="selectModel"
      @open-settings="openSettings"
      @toggle-sidebar="toggleSidebar"
    />

    <!-- Mobile overlay when sidebar is open -->
    <Transition name="fade">
      <div
        v-if="sidebarOpen"
        class="sidebar-overlay"
        @click="toggleSidebar"
      ></div>
    </Transition>

    <!-- Main Content -->
    <main class="main-content">
      <!-- Fallback Notification Toast -->
      <Transition name="slide-down">
        <div v-if="fallbackToast" class="fallback-toast-alert glass">
          <AlertCircle :size="15" />
          <span>{{ fallbackToast }}</span>
          <button class="toast-dismiss-btn" @click="fallbackToast = ''">
            <X :size="12" />
          </button>
        </div>
      </Transition>

      <!-- Top Bar -->
      <header class="top-bar">
        <div class="top-bar-left">
          <button
            v-if="!sidebarOpen"
            class="toggle-sidebar-btn"
            @click="toggleSidebar"
            title="Open sidebar"
            id="open-sidebar-btn"
          >
            <PanelLeft :size="18" />
          </button>
        </div>

        <!-- Engine Indicator Badge (PC Server vs Laptop) -->
        <div class="top-bar-right">
          <button
            class="engine-status-pill"
            :class="currentEngine === 'pc' ? 'engine-status-pill--pc' : 'engine-status-pill--laptop'"
            @click="toggleEngine"
            :title="`Engine aktif: ${currentEngine === 'pc' ? 'PC Server' : 'Laptop'}. Klik untuk beralih ke ${currentEngine === 'pc' ? 'Laptop' : 'PC Server'}.`"
          >
            <span
              class="engine-dot"
              :class="{
                'engine-dot--online': isCurrentEngineOnline === true,
                'engine-dot--offline': isCurrentEngineOnline === false,
                'engine-dot--unknown': isCurrentEngineOnline === null,
              }"
            ></span>
            <Server v-if="currentEngine === 'pc'" :size="13" />
            <Laptop v-else :size="13" />
            <span>{{ currentEngine === 'pc' ? 'PC Server' : 'Laptop' }}</span>
          </button>
        </div>
      </header>

      <!-- Chat View -->
      <ChatView
        :messages="activeMessages"
        :is-generating="isGenerating"
        :model-name="selectedModel"
        @send="sendMessage"
        @stop="stopGeneration"
        @regenerate="handleRegenerate"
      />
    </main>

    <!-- Settings Modal -->
    <SettingsModal
      v-if="showSettings"
      :conversations="conversations"
      :folders="folders"
      @close="closeSettings"
      @save="onSettingsSave"
      @folder-changed="onFolderChanged"
      @import-data="handleImportData"
    />
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
}

.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border);
  min-height: 48px;
  background: var(--color-bg-primary);
  position: relative;
  z-index: 10;
}

.top-bar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.top-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.engine-status-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 20px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  font-size: 0.76rem;
  font-weight: 600;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.engine-status-pill:hover {
  transform: translateY(-1px);
  border-color: var(--color-border-light);
}

.engine-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.engine-dot--online {
  background: var(--color-success);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.7);
}

.engine-dot--offline {
  background: var(--color-danger);
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.7);
}

.engine-dot--unknown {
  background: var(--color-text-muted);
}

/* PC SERVER: Emerald (#10b981) / Green (#22c55e) */
.engine-status-pill--pc {
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.35);
  color: #10b981;
}

.engine-status-pill--pc:hover {
  background: rgba(16, 185, 129, 0.18);
  border-color: #10b981;
  color: #22c55e;
  box-shadow: 0 0 14px rgba(16, 185, 129, 0.35);
}

.engine-status-pill--pc .engine-dot--online {
  background: #00FF00;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.8), 0 0 12px rgba(34, 197, 94, 0.4);
  animation: dotPulseEmerald 2.5s infinite ease-in-out;
}

/* LAPTOP: Cyan (#06b6d4) / Blue (#3b82f6) */
.engine-status-pill--laptop {
  background: rgba(6, 182, 212, 0.12);
  border-color: rgba(6, 182, 212, 0.35);
  color: #06b6d4;
}

.engine-status-pill--laptop:hover {
  background: rgba(6, 182, 212, 0.18);
  border-color: #06b6d4;
  color: #3b82f6;
  box-shadow: 0 0 14px rgba(6, 182, 212, 0.35);
}

.engine-status-pill--laptop .engine-dot--online {
  background: #00ff00;
  box-shadow: 0 0 8px rgba(6, 182, 212, 0.8), 0 0 12px rgba(59, 130, 246, 0.4);
  animation: dotPulseCyan 2.5s infinite ease-in-out;
}

@keyframes dotPulseEmerald {
  0%, 100% {
    box-shadow: 0 0 6px rgba(16, 185, 129, 0.7);
  }
  50% {
    box-shadow: 0 0 12px rgba(16, 185, 129, 1), 0 0 16px rgba(34, 197, 94, 0.5);
  }
}

@keyframes dotPulseCyan {
  0%, 100% {
    box-shadow: 0 0 6px rgba(6, 182, 212, 0.7);
  }
  50% {
    box-shadow: 0 0 12px rgba(6, 182, 212, 1), 0 0 16px rgba(59, 130, 246, 0.5);
  }
}

/* Fallback toast alert */
.fallback-toast-alert {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 10px;
  background: rgba(245, 158, 11, 0.2);
  border: 1px solid rgba(245, 158, 11, 0.5);
  color: #fcd34d;
  font-size: 0.78rem;
  font-weight: 500;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

.toast-dismiss-btn {
  background: none;
  border: none;
  color: #fcd34d;
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.8;
}

.toast-dismiss-btn:hover {
  opacity: 1;
}

.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.25s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translate(-50%, -10px);
}

.toggle-sidebar-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s ease, background 0.15s ease;
  animation: fadeInBtn 0.2s ease 0.15s both;
}

@keyframes fadeInBtn {
  from {
    opacity: 0;
    transform: scale(0.85);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.toggle-sidebar-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.top-bar-info {
  display: flex;
  align-items: center;
}

.model-badge {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text-accent);
  background: var(--color-accent-subtle);
  padding: 4px 12px;
  border-radius: 20px;
  border: 1px solid rgba(139, 92, 246, 0.2);
}

.sidebar-overlay {
  display: none;
}

@media (max-width: 768px) {
  .sidebar-overlay {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 80;
  }
}
</style>
