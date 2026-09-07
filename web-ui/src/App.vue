<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import Sidebar from './components/Sidebar.vue'
import ChatView from './components/ChatView.vue'
import SettingsModal from './components/SettingsModal.vue'
import { PanelLeft } from 'lucide-vue-next'
import { getModels, sendMessageStream } from './services/api.js'

// ===== State =====
const DEFAULT_MODELS = [
  { name: 'qwen2.5:7b', desc: 'For Fun' },
  { name: 'qwen2.5-coder:7b', desc: 'For Logic' },
]

const sidebarOpen = ref(true)
const showSettings = ref(false)
const models = ref([...DEFAULT_MODELS])
const selectedModel = ref('qwen2.5:7b')
const isGenerating = ref(false)

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

// ===== Lifecycle =====
onMounted(async () => {
  // Load saved state
  loadState()

  // Fetch models
  await fetchModels()

  // If no conversations, create one
  if (conversations.length === 0) {
    createNewChat()
  }
})

// ===== API =====
async function fetchModels() {
  const fetched = await getModels()
  const map = new Map()

  // Add default Qwen models
  for (const m of DEFAULT_MODELS) {
    map.set(m.name, { ...m })
  }

  // Merge with fetched models from Qwen
  for (const m of fetched) {
    const existing = map.get(m.name) || {}
    map.set(m.name, {
      ...m,
      desc: existing.desc || (m.size ? `${(m.size / 1e9).toFixed(1)}GB` : ''),
    })
  }

  models.value = Array.from(map.values())

  if (!selectedModel.value) {
    const first = models.value[0]
    selectedModel.value = (typeof first === 'object' ? first.name : first) || 'qwen2.5:7b'
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
    saveState()
  }
}

function deleteChat(id) {
  const idx = conversations.findIndex((c) => c.id === id)
  if (idx === -1) return

  conversations.splice(idx, 1)

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
    saveState()
  }
}

// ===== Messaging =====
async function sendMessage(text) {
  if (!activeConversation.value || isGenerating.value) return

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

  // Add empty assistant message for streaming
  activeConversation.value.messages.push({
    role: 'assistant',
    content: '',
  })

  const assistantIdx = activeConversation.value.messages.length - 1
  isGenerating.value = true

  // Prepare messages for API (all messages in conversation)
  const apiMessages = activeConversation.value.messages
    .slice(0, -1) // exclude the empty assistant message
    .map((m) => ({ role: m.role, content: m.content }))

  abortController = new AbortController()

  await sendMessageStream({
    model: selectedModel.value,
    messages: apiMessages,
    signal: abortController.signal,
    onToken: (token) => {
      activeConversation.value.messages[assistantIdx].content += token
    },
    onDone: () => {
      isGenerating.value = false
      abortController = null
      saveState()
    },
    onError: (err) => {
      isGenerating.value = false
      abortController = null
      const errMsg = activeConversation.value.messages[assistantIdx]
      if (!errMsg.content) {
        errMsg.content = `❌ Error: ${err.message}\n\nPastikan LLM sudah berjalan di server lokal Anda.`
      }
      saveState()
    },
  })
}

function stopGeneration() {
  if (abortController) {
    abortController.abort()
    abortController = null
    isGenerating.value = false
  }
}

// ===== Model =====
function selectModel(modelName) {
  selectedModel.value = modelName
  saveState()
}

// ===== Settings =====
function openSettings() {
  showSettings.value = true
}

function closeSettings() {
  showSettings.value = false
}

function onSettingsSave() {
  // Refresh models with new API URL
  fetchModels()
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
  } catch (e) {
    // ignore
  }
}

function loadState() {
  try {
    const saved = localStorage.getItem('llm-chat-state')
    if (saved) {
      const state = JSON.parse(saved)
      if (state.folders && Array.isArray(state.folders)) {
        folders.push(
          ...state.folders.map((f) => ({
            ...f,
            parentId: f.parentId || null,
          }))
        )
      }
      if (state.conversations && Array.isArray(state.conversations)) {
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

  if (!selectedModel.value) {
    selectedModel.value = 'qwen2.5:7b'
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
      <!-- Top Bar -->
      <header class="top-bar">
        <button
          v-if="!sidebarOpen"
          class="toggle-sidebar-btn"
          @click="toggleSidebar"
          title="Open sidebar"
          id="open-sidebar-btn"
        >
          <PanelLeft :size="18" />
        </button>
        <div class="top-bar-info">
          <span v-if="selectedModel" class="model-badge">
            {{ selectedModel }}
          </span>
        </div>
      </header>

      <!-- Chat View -->
      <ChatView
        :messages="activeMessages"
        :is-generating="isGenerating"
        :model-name="selectedModel"
        @send="sendMessage"
        @stop="stopGeneration"
      />
    </main>

    <!-- Settings Modal -->
    <SettingsModal
      v-if="showSettings"
      @close="closeSettings"
      @save="onSettingsSave"
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
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border);
  min-height: 48px;
  background: var(--color-bg-primary);
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
  flex: 1;
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
