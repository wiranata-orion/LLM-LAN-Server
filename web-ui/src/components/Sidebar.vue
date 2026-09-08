<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import {
  Plus,
  MessageSquare,
  Settings,
  Trash2,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  Bot,
  Pencil,
  Check,
  X,
  Folder,
  FolderPlus,
  FolderOpen,
  FolderInput,
  AlertCircle,
  EllipsisVertical,
} from 'lucide-vue-next'

import FolderItem from './FolderItem.vue'

const props = defineProps({
  conversations: {
    type: Array,
    default: () => [],
  },
  folders: {
    type: Array,
    default: () => [],
  },
  activeId: {
    type: String,
    default: null,
  },
  models: {
    type: Array,
    default: () => [],
  },
  selectedModel: {
    type: String,
    default: '',
  },
  isOpen: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits([
  'new-chat',
  'select-chat',
  'delete-chat',
  'rename-chat',
  'create-folder',
  'rename-folder',
  'delete-folder',
  'toggle-folder-expand',
  'move-folder',
  'move-chat',
  'select-model',
  'open-settings',
  'toggle-sidebar',
])

// ===== Model Dropdown =====
const showModelDropdown = ref(false)

function toggleModelDropdown() {
  showModelDropdown.value = !showModelDropdown.value
}

function selectModel(modelName) {
  emit('select-model', modelName)
  showModelDropdown.value = false
}

function getModelName(model) {
  return typeof model === 'string' ? model : (model.name || '')
}

function getModelBadge(model) {
  if (typeof model === 'string') return ''
  if (model.desc) return model.desc
  if (model.size) return (model.size / 1e9).toFixed(1) + 'GB'
  return ''
}

const selectedModelDisplay = computed(() => {
  return props.selectedModel || 'Select Model'
})

// ===== Conversation Title Helper =====
function getConversationTitle(conv) {
  if (conv.title) return conv.title
  if (conv.messages && conv.messages.length > 0) {
    const firstMsg = conv.messages.find((m) => m.role === 'user')
    if (firstMsg) return firstMsg.content.substring(0, 40) + (firstMsg.content.length > 40 ? '...' : '')
  }
  return 'New Chat'
}

// ===== Rename Conversation =====
const editingChatId = ref(null)
const editingChatTitle = ref('')

function startEditChat(conv, e) {
  if (e) e.stopPropagation()
  editingChatId.value = conv.id
  editingChatTitle.value = conv.title || getConversationTitle(conv)
}

function saveChatTitle(id, e) {
  if (e) e.stopPropagation()
  const title = editingChatTitle.value.trim()
  if (title) {
    emit('rename-chat', id, title)
  }
  editingChatId.value = null
}

function cancelEditChat(e) {
  if (e) e.stopPropagation()
  editingChatId.value = null
}

// Collapsible Sections: Folder Conversations & Chat Conversations
const isFoldersExpanded = ref(true)
const isChatsExpanded = ref(true)

function toggleFoldersSection() {
  isFoldersExpanded.value = !isFoldersExpanded.value
  try {
    localStorage.setItem('sidebar_folders_expanded', isFoldersExpanded.value)
  } catch (e) {}
}

function toggleChatsSection() {
  isChatsExpanded.value = !isChatsExpanded.value
  try {
    localStorage.setItem('sidebar_chats_expanded', isChatsExpanded.value)
  } catch (e) {}
}

const isCreatingFolder = ref(false)
const newFolderName = ref('')

function startCreateFolder() {
  isFoldersExpanded.value = true
  isCreatingFolder.value = true
  newFolderName.value = ''
}

function confirmCreateFolder() {
  const name = newFolderName.value.trim()
  if (name) {
    emit('create-folder', name)
  }
  isCreatingFolder.value = false
  newFolderName.value = ''
}

function cancelCreateFolder() {
  isCreatingFolder.value = false
  newFolderName.value = ''
}



// Delete Folder with Strict Rule Check
const toastMessage = ref('')
let toastTimer = null

function showToast(msg) {
  toastMessage.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastMessage.value = ''
  }, 4500)
}

function handleDeleteFolder(folder, e) {
  if (e) e.stopPropagation()
  const chats = props.conversations.filter((c) => c.folderId === folder.id)
  const subfolders = props.folders.filter((f) => f.parentId === folder.id)
  if (chats.length > 0 || subfolders.length > 0) {
    const reasons = []
    if (chats.length > 0) reasons.push(`${chats.length} percakapan`)
    if (subfolders.length > 0) reasons.push(`${subfolders.length} subfolder`)
    showToast(`Folder "${folder.name}" tidak dapat dihapus karena masih ada ${reasons.join(' dan ')} di dalamnya. Kosongkan folder terlebih dahulu.`)
    return
  }
  emit('delete-folder', folder.id)
}

const rootFolders = computed(() => {
  return props.folders.filter((f) => !f.parentId)
})

const rootChats = computed(() => {
  return props.conversations.filter((c) => !c.folderId || !props.folders.some((f) => f.id === c.folderId))
})

function getFolderDisplayName(folder) {
  const parts = [folder.name]
  let curr = folder
  while (curr.parentId) {
    const parent = props.folders.find((f) => f.id === curr.parentId)
    if (parent) {
      parts.unshift(parent.name)
      curr = parent
    } else {
      break
    }
  }
  return parts.join(' / ')
}

// Root Chat 3-Dots Menu & Move Dropdown
const activeChatMenuId = ref(null)
const showMoveSubmenuForChatId = ref(null)

function toggleChatMenu(chatId, e) {
  if (e) e.stopPropagation()
  activeChatMenuId.value = activeChatMenuId.value === chatId ? null : chatId
  showMoveSubmenuForChatId.value = null
}

function toggleMoveSubmenu(chatId, e) {
  if (e) e.stopPropagation()
  showMoveSubmenuForChatId.value = showMoveSubmenuForChatId.value === chatId ? null : chatId
}

function handleMoveChat(chatId, folderId, e) {
  if (e) e.stopPropagation()
  emit('move-chat', chatId, folderId)
  activeChatMenuId.value = null
  showMoveSubmenuForChatId.value = null
}

function handleDeleteChat(chatId, e) {
  if (e) e.stopPropagation()
  activeChatMenuId.value = null
  showMoveSubmenuForChatId.value = null
  emit('delete-chat', chatId)
}

// Drag & Drop
const draggedItem = ref(null) // { type: 'chat' | 'folder', id: string }
const dragOverFolderId = ref(null)

function isDescendantOf(potentialDescendantId, ancestorId) {
  let curr = props.folders.find((f) => f.id === potentialDescendantId)
  while (curr) {
    if (curr.parentId === ancestorId) return true
    curr = props.folders.find((f) => f.id === curr.parentId)
  }
  return false
}

function handleDragStart(e, item) {
  if (e && e.dataTransfer) {
    e.dataTransfer.setData('text/plain', JSON.stringify(item))
    e.dataTransfer.effectAllowed = 'move'
  }
  setTimeout(() => {
    draggedItem.value = item
  }, 30)
}

function handleDragEnd() {
  draggedItem.value = null
  dragOverFolderId.value = null
}

function handleDragOverFolder(e, folderId) {
  e.preventDefault()
  if (draggedItem.value?.type === 'folder') {
    if (draggedItem.value.id === folderId) return
    if (isDescendantOf(folderId, draggedItem.value.id)) return
  }
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  dragOverFolderId.value = folderId
}

function handleDragLeaveFolder(folderId) {
  if (dragOverFolderId.value === folderId) {
    dragOverFolderId.value = null
  }
}

function handleDropFolder(e, folderId) {
  e.preventDefault()
  dragOverFolderId.value = null
  let item = draggedItem.value
  if (!item && e && e.dataTransfer) {
    try {
      item = JSON.parse(e.dataTransfer.getData('text/plain'))
    } catch (err) {}
  }
  if (!item) return

  if (item.type === 'chat') {
    emit('move-chat', item.id, folderId)
  } else if (item.type === 'folder') {
    if (item.id !== folderId && !isDescendantOf(folderId, item.id)) {
      emit('move-folder', item.id, folderId)
    }
  }
  draggedItem.value = null
}

function handleDropRoot(e) {
  e.preventDefault()
  dragOverFolderId.value = null
  let item = draggedItem.value
  if (!item && e && e.dataTransfer) {
    try {
      item = JSON.parse(e.dataTransfer.getData('text/plain'))
    } catch (err) {}
  }
  if (!item) return

  if (item.type === 'chat') {
    emit('move-chat', item.id, null)
  } else if (item.type === 'folder') {
    emit('move-folder', item.id, null)
  }
  draggedItem.value = null
}

// Click outside handling for menus
function handleClickOutside(e) {
  if (!e.target.closest('.more-menu-wrapper')) {
    activeChatMenuId.value = null
    showMoveSubmenuForChatId.value = null
  }
  if (!e.target.closest('.model-selector-wrapper')) {
    showModelDropdown.value = false
  }
}

onMounted(() => {
  try {
    const savedFoldersExp = localStorage.getItem('sidebar_folders_expanded')
    if (savedFoldersExp !== null) isFoldersExpanded.value = savedFoldersExp === 'true'
    const savedChatsExp = localStorage.getItem('sidebar_chats_expanded')
    if (savedChatsExp !== null) isChatsExpanded.value = savedChatsExp === 'true'
  } catch (e) {}

  window.addEventListener('click', handleClickOutside)
  window.addEventListener('dragend', handleDragEnd)
})

onUnmounted(() => {
  window.removeEventListener('click', handleClickOutside)
  window.removeEventListener('dragend', handleDragEnd)
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar--closed': !isOpen }">
    <!-- Header -->
    <div class="sidebar-header">
      <div class="sidebar-brand">
        <span class="brand-text">Xufruz LLM</span>
      </div>
      <button class="icon-btn" @click="$emit('toggle-sidebar')" title="Close sidebar" id="close-sidebar-btn">
        <PanelLeftClose :size="18" />
      </button>
    </div>

    <!-- Model Selector -->
    <div class="model-selector-wrapper">
      <button class="model-selector" @click="toggleModelDropdown" id="model-selector-btn">
        <span class="model-name">{{ selectedModelDisplay }}</span>
        <ChevronDown :size="14" :class="{ rotated: showModelDropdown }" />
      </button>

      <Transition name="fade">
        <div v-if="showModelDropdown" class="model-dropdown glass">
          <div
            v-if="models.length === 0"
            class="model-option model-option--empty"
          >
            No models
          </div>
          <button
            v-for="model in models"
            :key="getModelName(model)"
            class="model-option"
            :class="{ 'model-option--active': getModelName(model) === selectedModel }"
            @click="selectModel(getModelName(model))"
          >
            <span class="model-option-name">{{ getModelName(model) }}</span>
            <span v-if="getModelBadge(model)" class="model-option-badge">
              {{ getModelBadge(model) }}
            </span>
          </button>
        </div>
      </Transition>
    </div>

    <!-- Quick Actions: New Chat & Folder Side by Side (Below Model, Above Conversations) -->
    <div class="sidebar-actions-row">
      <button
        class="quick-action-btn quick-action-btn--primary"
        @click="$emit('new-chat', null)"
        id="new-chat-btn"
        title="Mulai Chat Baru"
      >
        <Plus :size="15" />
        <span>New Chat</span>
      </button>

      <button
        class="quick-action-btn quick-action-btn--secondary"
        @click="startCreateFolder"
        id="new-folder-btn"
        title="Buat Folder Baru"
      >
        <FolderPlus :size="15" />
        <span>Folder</span>
      </button>
    </div>

    <!-- Conversation List -->
    <div class="conversation-list">
      <!-- Prominent Root Drop Banner (Visible when dragging any folder or chat) -->
      <div
        v-if="draggedItem"
        class="root-drop-banner"
        :class="{ 'root-drop-banner--dragover': dragOverFolderId === 'root-banner' }"
        @dragover.prevent="handleDragOverFolder($event, 'root-banner')"
        @dragleave="handleDragLeaveFolder('root-banner')"
        @drop.prevent="handleDropRoot"
      >
        <FolderOpen :size="14" class="root-drop-icon" />
        <span>Lepas di sini untuk keluarkan ke Root (Level Terluar)</span>
      </div>

      <!-- FOLDER CONVERSATIONS SECTION -->
      <div class="collapsible-section">
        <div
          class="collapsible-section-header"
          @click="toggleFoldersSection"
          role="button"
          tabindex="0"
          title="Klik untuk sembunyikan/tampilkan Folder Conversations"
        >
          <div class="section-header-left">
            <ChevronRight
              :size="13"
              class="section-chevron"
              :class="{ 'section-chevron--expanded': isFoldersExpanded }"
            />
            <span class="section-label">Folder Conversations</span>
          </div>
          <span class="section-count-badge">{{ rootFolders.length }}</span>
        </div>

        <!-- Inline Create Folder Form -->
        <div v-if="isCreatingFolder" class="folder-create-box">
          <div class="folder-create-input-wrapper">
            <Folder :size="14" class="folder-input-icon" />
            <input
              v-model="newFolderName"
              @keydown.enter="confirmCreateFolder"
              @keydown.esc="cancelCreateFolder"
              placeholder="Nama folder..."
              class="folder-create-input"
              autofocus
            />
          </div>
          <div class="folder-create-actions">
            <button class="btn-micro btn-micro--confirm" @click="confirmCreateFolder" title="Buat">
              <Check :size="12" />
            </button>
            <button class="btn-micro btn-micro--cancel" @click="cancelCreateFolder" title="Batal">
              <X :size="12" />
            </button>
          </div>
        </div>

        <!-- FOLDERS LIST (COLLAPSIBLE & INDENTED) -->
        <div v-show="isFoldersExpanded" class="collapsible-section-content">
          <FolderItem
            v-for="folder in rootFolders"
            :key="folder.id"
            :folder="folder"
            :all-folders="folders"
            :conversations="conversations"
            :active-id="activeId"
            :depth="0"
            :drag-over-id="dragOverFolderId"
            @select-chat="$emit('select-chat', $event)"
            @delete-chat="$emit('delete-chat', $event)"
            @rename-chat="(id, title) => $emit('rename-chat', id, title)"
            @create-chat="$emit('new-chat', $event)"
            @create-folder="(name, parentId) => $emit('create-folder', name, parentId)"
            @rename-folder="(id, name) => $emit('rename-folder', id, name)"
            @delete-folder="handleDeleteFolder"
            @toggle-folder-expand="$emit('toggle-folder-expand', $event)"
            @move-chat="(cId, fId) => $emit('move-chat', cId, fId)"
            @move-folder="(fId, tId) => $emit('move-folder', fId, tId)"
            @drag-start="handleDragStart"
            @drag-end="handleDragEnd"
            @drag-over="handleDragOverFolder"
            @drag-leave="handleDragLeaveFolder"
            @drop="handleDropFolder"
          />

          <div v-if="rootFolders.length === 0 && !isCreatingFolder" class="section-empty-hint">
            <span>Belum ada folder</span>
          </div>
        </div>
      </div>

      <!-- CHAT CONVERSATIONS SECTION -->
      <div class="collapsible-section">
        <div
          class="collapsible-section-header collapsible-section-header--chats"
          :class="{ 'root-chats-divider--dragover': dragOverFolderId === 'root' }"
          @click="toggleChatsSection"
          @dragover.prevent="handleDragOverFolder($event, 'root')"
          @dragleave="handleDragLeaveFolder('root')"
          @drop.prevent="handleDropRoot"
          role="button"
          tabindex="0"
          title="Klik untuk sembunyikan/tampilkan Chat Conversations"
        >
          <div class="section-header-left">
            <ChevronRight
              :size="13"
              class="section-chevron"
              :class="{ 'section-chevron--expanded': isChatsExpanded }"
            />
            <span class="section-label">Chat Conversations</span>
          </div>
          <span class="section-count-badge">{{ rootChats.length }}</span>
        </div>

        <!-- ROOT CHATS LIST (COLLAPSIBLE & INDENTED) -->
        <div v-show="isChatsExpanded" class="collapsible-section-content">
          <div
            v-for="conv in rootChats"
            :key="conv.id"
            class="conversation-item"
            :class="{
              'conversation-item--active': conv.id === activeId,
              'conversation-item--menu-open': activeChatMenuId === conv.id,
            }"
            @click="$emit('select-chat', conv.id)"
            draggable="true"
            @dragstart="handleDragStart($event, { type: 'chat', id: conv.id })"
            @dragend="handleDragEnd"
            role="button"
            tabindex="0"
          >
            <!-- Editing Chat Title Inline -->
            <div v-if="editingChatId === conv.id" class="inline-edit-box inline-edit-box--chat" @click.stop>
              <input
                v-model="editingChatTitle"
                @keydown.enter="saveChatTitle(conv.id, $event)"
                @keydown.esc="cancelEditChat($event)"
                class="inline-edit-input"
                autofocus
              />
              <button class="btn-micro btn-micro--confirm" @click="saveChatTitle(conv.id, $event)">
                <Check :size="11" />
              </button>
              <button class="btn-micro btn-micro--cancel" @click="cancelEditChat($event)">
                <X :size="11" />
              </button>
            </div>

            <!-- Normal Chat Display -->
            <template v-else>
              <MessageSquare :size="15" class="conv-icon" />
              <span class="conv-title" :title="getConversationTitle(conv)">
                {{ getConversationTitle(conv) }}
              </span>

              <div class="conv-actions" @click.stop>
                <!-- Edit Title Button (OUTSIDE) -->
                <button
                  class="conv-action-btn"
                  @click="startEditChat(conv, $event)"
                  title="Edit nama chat"
                >
                  <Pencil :size="13" />
                </button>

                <!-- Titik Tiga (More) Dropdown (INSIDE: Pindahkan ke Folder & Hapus Chat) -->
                <div class="more-menu-wrapper">
                  <button
                    class="conv-action-btn"
                    @click="toggleChatMenu(conv.id, $event)"
                    title="Pilihan lainnya"
                  >
                    <EllipsisVertical :size="13" />
                  </button>

                  <div v-if="activeChatMenuId === conv.id" class="more-dropdown glass">
                    <!-- Pindahkan ke Folder Option -->
                    <button
                      v-if="folders.length > 0"
                      class="more-dropdown-option"
                      @click="toggleMoveSubmenu(conv.id, $event)"
                    >
                      <FolderInput :size="13" />
                      <span>Pindahkan ke Folder</span>
                    </button>

                    <!-- Submenu Folder List -->
                    <div v-if="showMoveSubmenuForChatId === conv.id" class="move-subfolder-list">
                      <button
                        v-for="f in folders"
                        :key="f.id"
                        class="move-subfolder-option"
                        @click="handleMoveChat(conv.id, f.id, $event)"
                      >
                        <Folder :size="11" />
                        <span class="move-option-name">{{ getFolderDisplayName(f) }}</span>
                      </button>
                    </div>

                    <!-- Hapus Chat (inside titik tiga) -->
                    <button
                      class="more-dropdown-option more-dropdown-option--danger"
                      @click="handleDeleteChat(conv.id, $event)"
                      title="Hapus percakapan"
                    >
                      <Trash2 :size="13" />
                      <span>Hapus Chat</span>
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <div v-if="rootChats.length === 0" class="section-empty-hint">
            <span>Belum ada chat di luar folder</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Toast Alert for Folder Delete Rule -->
    <Transition name="fade">
      <div v-if="toastMessage" class="folder-alert-toast glass">
        <AlertCircle :size="15" class="toast-icon" />
        <span class="toast-text">{{ toastMessage }}</span>
        <button class="toast-close-btn" @click="toastMessage = ''">
          <X :size="12" />
        </button>
      </div>
    </Transition>

    <!-- Footer -->
    <div class="sidebar-footer">
      <button class="settings-btn" @click="$emit('open-settings')" id="settings-btn">
        <Settings :size="16" />
        <span>Settings</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 280px;
  min-width: 280px;
  height: 100%;
  background: var(--color-bg-sidebar);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: margin-left 0.25s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.25s;
  will-change: margin-left;
}

.sidebar--closed {
  margin-left: -280px;
  visibility: hidden;
  pointer-events: none;
}

/* Header */
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-on-accent, white);
}

.brand-text {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--color-text-primary);
}

.icon-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.icon-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}



/* Model Selector */
.model-selector-wrapper {
  position: relative;
  margin: 12px 12px 0;
}

.model-selector {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: var(--font-sans);
  color: var(--color-text-primary);
}

.model-selector:hover {
  border-color: var(--color-border-light);
}

.model-label {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.model-name {
  flex: 1;
  text-align: left;
  font-size: 0.8rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-selector svg {
  color: var(--color-text-muted);
  transition: transform 0.2s ease;
}

.rotated {
  transform: rotate(180deg);
}

.model-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  border-radius: 10px;
  padding: 4px;
  z-index: 50;
  max-height: 240px;
  overflow-y: auto;
}

.model-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s ease;
  font-family: var(--font-sans);
  text-align: left;
}

.model-option:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.model-option--active {
  background: var(--color-accent-subtle);
  color: var(--color-text-accent);
}

.model-option--empty {
  cursor: default;
  color: var(--color-text-muted);
  font-style: italic;
}

.model-option-size,
.model-option-badge {
  font-size: 0.68rem;
  color: var(--color-text-muted);
  background: var(--color-bg-hover);
  padding: 2px 7px;
  border-radius: 6px;
  font-weight: 500;
  white-space: nowrap;
}

.model-option--active .model-option-badge {
  color: var(--color-text-accent);
  background: var(--color-accent-subtle);
}

/* Conversation List */
.conversation-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0;
}

/* Quick Actions Row (Below Model, Above Conversations) */
.sidebar-actions-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 10px 12px 4px;
}

.quick-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 12px;
  border-radius: 9px;
  font-size: 0.82rem;
  font-weight: 500;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;
}

.quick-action-btn--primary {
  background: var(--color-accent-subtle);
  border: 1px solid var(--color-accent);
  color: var(--color-text-accent);
}

.quick-action-btn--primary:hover {
  background: var(--color-accent-subtle);
  border-color: var(--color-accent);
  box-shadow: 0 0 14px var(--color-accent-glow);
  transform: translateY(-1px);
}

.quick-action-btn--secondary {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}

.quick-action-btn--secondary:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  border-color: var(--color-border-light);
  transform: translateY(-1px);
}

.quick-action-btn:active {
  transform: translateY(0);
}

/* Collapsible Sections & Headers (Folder Conversations & Chat Conversations) */
.collapsible-section {
  padding: 0 8px;
  margin-bottom: 6px;
}

.collapsible-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 8px;
  margin: 2px 0 3px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;
}

.collapsible-section-header:hover {
  background: var(--color-bg-hover);
}

.collapsible-section-header--chats {
  margin-top: 6px;
}

.section-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.section-chevron {
  color: var(--color-text-muted);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.section-chevron--expanded {
  transform: rotate(90deg);
}

.section-label {
  font-size: 0.72rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  margin: 0;
  transition: color 0.15s ease;
}

.collapsible-section-header:hover .section-label {
  color: var(--color-text-primary);
}

.section-count-badge {
  font-size: 0.65rem;
  font-weight: 500;
  color: var(--color-text-muted);
  background: var(--color-bg-tertiary);
  padding: 1px 6px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.section-empty-hint {
  padding: 6px 12px;
  font-size: 0.72rem;
  color: var(--color-text-muted);
  font-style: italic;
  opacity: 0.75;
}

/* Indented Content for Folders and Chats under their section headers */
.collapsible-section-content {
  padding-left: 10px;
  margin-left: 6px;
  border-left: 1.5px solid rgba(255, 255, 255, 0.07);
  transition: all 0.2s ease;
}

/* Folder Creation Box */
.folder-create-box {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 8px 8px;
  padding: 6px 8px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-accent);
  border-radius: 8px;
  box-shadow: 0 0 12px var(--color-accent-glow);
}

.folder-create-input-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.folder-input-icon {
  color: var(--color-accent);
  flex-shrink: 0;
}

.folder-create-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--color-text-primary);
  font-size: 0.8rem;
  font-family: var(--font-sans);
  min-width: 0;
}

.folder-create-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn-micro {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.btn-micro--confirm {
  background: var(--color-accent);
  color: var(--color-on-accent, white);
}

.btn-micro--confirm:hover {
  background: var(--color-accent-hover);
}

.btn-micro--cancel {
  background: var(--color-bg-hover);
  color: var(--color-text-muted);
}

.btn-micro--cancel:hover {
  color: var(--color-text-primary);
}

.conversation-items {
  padding: 0 8px;
}

/* Folder Item */
.folder-item {
  margin-bottom: 4px;
  border-radius: 8px;
  transition: background 0.15s ease;
}

.folder-item--dragover {
    background: var(--color-accent-subtle);
    border-color: var(--color-accent);
}

.folder-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;
}

.folder-header:hover {
  background: var(--color-bg-hover);
}

.folder-chevron {
  color: var(--color-text-muted);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.folder-chevron--expanded {
  transform: rotate(90deg);
}

.folder-icon {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.folder-icon--open {
  color: var(--color-text-accent);
}

.folder-meta {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}

.folder-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.folder-count-badge {
  font-size: 0.65rem;
  font-weight: 500;
  color: var(--color-text-muted);
  background: var(--color-bg-tertiary);
  padding: 1px 6px;
  border-radius: 10px;
  flex-shrink: 0;
}

.folder-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.folder-header:hover .folder-actions {
  opacity: 1;
}

.folder-action-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 3px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.folder-action-btn:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.08);
}

.folder-action-btn--locked {
  cursor: not-allowed;
  opacity: 0.5;
}

.folder-action-btn--locked:hover {
  color: var(--color-danger);
  background: rgba(239, 68, 68, 0.1);
}

/* Folder Contents */
.folder-contents {
  margin-left: 14px;
  padding-left: 6px;
  border-left: 1px solid var(--color-border);
  margin-top: 2px;
  margin-bottom: 4px;
}

.folder-empty-state {
  padding: 6px 10px;
  font-size: 0.72rem;
  color: var(--color-text-muted);
  font-style: italic;
}

/* Nested & Root Conversation Items */
.conversation-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.82rem;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.15s ease;
  text-align: left;
  font-family: var(--font-sans);
  position: relative;
}

.conversation-item--nested {
  padding: 7px 9px;
  font-size: 0.8rem;
}

.conversation-item:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.conversation-item--active {
  background: var(--color-accent-subtle) !important;
  color: var(--color-text-accent) !important;
}

.conv-icon {
  flex-shrink: 0;
}

.conv-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conv-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.conversation-item:hover .conv-actions {
  opacity: 1;
}

.conv-action-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.conv-action-btn:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.08);
}

.conv-action-btn--delete:hover {
  color: var(--color-danger);
  background: rgba(239, 68, 68, 0.1);
}

/* Inline Edit Box */
.inline-edit-box {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.inline-edit-box--chat {
  width: 100%;
}

.inline-edit-input {
  flex: 1;
  background: var(--color-bg-input);
  border: 1px solid var(--color-accent);
  color: var(--color-text-primary);
  font-size: 0.8rem;
  font-family: var(--font-sans);
  border-radius: 5px;
  padding: 3px 6px;
  outline: none;
  min-width: 0;
}

/* Move to Folder Dropdown */
.move-menu-container {
  position: relative;
}

.move-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 80;
  min-width: 160px;
  max-height: 200px;
  overflow-y: auto;
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

.move-dropdown-title {
  font-size: 0.68rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 8px;
  font-weight: 500;
}

.move-dropdown-option {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.76rem;
  font-family: var(--font-sans);
  border-radius: 5px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.move-dropdown-option:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.move-dropdown-option--active {
  color: var(--color-text-accent);
  background: var(--color-accent-subtle);
}

.move-option-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Root Chats Divider */
.root-chats-divider {
  font-size: 0.68rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 12px 10px 4px;
  font-weight: 500;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.root-chats-divider--dragover {
  background: var(--color-accent-subtle);
  color: var(--color-text-accent);
  border: 1px dashed var(--color-accent);
  padding: 10px 10px;
}

/* Toast Alert */
.folder-alert-toast {
  position: absolute;
  bottom: 64px;
  left: 10px;
  right: 10px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

.toast-icon {
  flex-shrink: 0;
  color: var(--color-danger);
}

.toast-text {
  flex: 1;
  font-size: 0.74rem;
  line-height: 1.4;
}

.toast-close-btn {
  background: none;
  border: none;
  color: #fca5a5;
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0.8;
}

.toast-close-btn:hover {
  opacity: 1;
}

/* Footer */
.sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--color-border);
}

.settings-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 0.82rem;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.15s ease;
  font-family: var(--font-sans);
}

.settings-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

/* Root Drop Banner (Visible when dragging) */
.root-drop-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 12px;
  margin: 6px 10px;
  border-radius: 8px;
  border: 1.5px dashed var(--color-accent);
  background: var(--color-accent-subtle);
  color: var(--color-text-accent);
  font-size: 0.76rem;
  font-weight: 500;
  text-align: center;
  cursor: copy;
  transition: all 0.2s ease;
  animation: pulse-drop 1.8s infinite ease-in-out;
}

@keyframes pulse-drop {
  0%, 100% {
    background: var(--color-accent-subtle);
    border-color: var(--color-accent);
  }
  50% {
    background: var(--color-accent-subtle);
    border-color: var(--color-accent);
  }
}

.root-drop-banner--dragover {
  background: var(--color-accent) !important;
  color: var(--color-on-accent, white) !important;
  border-color: var(--color-on-accent, white) !important;
  transform: scale(1.02);
  box-shadow: 0 4px 14px var(--color-accent-glow);
}

.root-drop-banner--bottom {
  margin-top: 12px;
  margin-bottom: 20px;
  padding: 8px 10px;
  font-size: 0.72rem;
  opacity: 0.85;
}

.root-drop-icon {
  flex-shrink: 0;
}

/* More Menu (Titik Tiga) Wrapper & Dropdown for Root Chats */
.more-menu-wrapper {
  position: relative;
}

.more-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 999;
  min-width: 175px;
  border-radius: 8px;
  padding: 5px;
  background: var(--color-bg-secondary, #181826);
  border: 1px solid var(--color-border);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.75);
}

.conversation-item--menu-open {
  position: relative;
  z-index: 80 !important;
}

.more-dropdown-option {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 9px;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.76rem;
  font-family: var(--font-sans);
  border-radius: 5px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.more-dropdown-option:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.more-dropdown-option--danger:hover {
  color: var(--color-danger) !important;
  background: rgba(239, 68, 68, 0.12) !important;
}

.move-subfolder-list {
  margin: 3px 0;
  padding: 3px 0 3px 6px;
  border-left: 2px solid var(--color-accent-subtle);
  max-height: 140px;
  overflow-y: auto;
}

.move-subfolder-option {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 4px 7px;
  border: none;
  background: none;
  color: var(--color-text-muted);
  font-size: 0.72rem;
  font-family: var(--font-sans);
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.move-subfolder-option:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.move-option-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 90;
    margin-left: 0;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
    transform: translateX(0);
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.25s;
    will-change: transform;
  }

  .sidebar--closed {
    margin-left: 0;
    transform: translateX(-100%);
    visibility: hidden;
    pointer-events: none;
  }
}
</style>
