<script>
export default {
  name: 'FolderItem',
}
</script>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import FolderItem from './FolderItem.vue'
import {
  Plus,
  MessageSquare,
  Trash2,
  ChevronRight,
  Pencil,
  Check,
  X,
  Folder,
  FolderPlus,
  FolderOpen,
  FolderInput,
  EllipsisVertical,
} from 'lucide-vue-next'

const props = defineProps({
  folder: {
    type: Object,
    required: true,
  },
  allFolders: {
    type: Array,
    default: () => [],
  },
  conversations: {
    type: Array,
    default: () => [],
  },
  activeId: {
    type: String,
    default: null,
  },
  depth: {
    type: Number,
    default: 0,
  },
  dragOverId: {
    type: String,
    default: null,
  },
})

const emit = defineEmits([
  'select-chat',
  'delete-chat',
  'rename-chat',
  'create-chat',
  'create-folder',
  'rename-folder',
  'delete-folder',
  'toggle-folder-expand',
  'move-chat',
  'move-folder',
  'drag-start',
  'drag-end',
  'drag-over',
  'drag-leave',
  'drop',
])

// ===== Subfolders & Chats =====
const childFolders = computed(() => {
  return props.allFolders.filter((f) => f.parentId === props.folder.id)
})

const folderChats = computed(() => {
  return props.conversations.filter((c) => c.folderId === props.folder.id)
})

const totalChildCount = computed(() => {
  let count = folderChats.value.length
  function countSubfolderChats(fId) {
    const subs = props.allFolders.filter((f) => f.parentId === fId)
    for (const sub of subs) {
      count += props.conversations.filter((c) => c.folderId === sub.id).length
      countSubfolderChats(sub.id)
    }
  }
  countSubfolderChats(props.folder.id)
  return count
})

// ===== More Menus (Titik Tiga) State =====
const showFolderMenu = ref(false)
const activeChatMenuId = ref(null)
const showMoveSubmenuForChatId = ref(null)

function toggleFolderMenu(e) {
  if (e) e.stopPropagation()
  showFolderMenu.value = !showFolderMenu.value
}

function handleCreateSubfolderClick(e) {
  if (e) e.stopPropagation()
  showFolderMenu.value = false
  startCreateSubfolder(e)
}

function toggleChatMenu(chatId, e) {
  if (e) e.stopPropagation()
  activeChatMenuId.value = activeChatMenuId.value === chatId ? null : chatId
  showMoveSubmenuForChatId.value = null
}

function toggleMoveSubmenu(chatId, e) {
  if (e) e.stopPropagation()
  showMoveSubmenuForChatId.value = showMoveSubmenuForChatId.value === chatId ? null : chatId
}

function handleMoveChat(chatId, targetFolderId, e) {
  if (e) e.stopPropagation()
  emit('move-chat', chatId, targetFolderId)
  activeChatMenuId.value = null
  showMoveSubmenuForChatId.value = null
}

function handleDeleteChat(chatId, e) {
  if (e) e.stopPropagation()
  activeChatMenuId.value = null
  showMoveSubmenuForChatId.value = null
  emit('delete-chat', chatId)
}

function handleGlobalClick(e) {
  if (!e.target.closest('.more-menu-wrapper')) {
    showFolderMenu.value = false
    activeChatMenuId.value = null
    showMoveSubmenuForChatId.value = null
  }
}

onMounted(() => {
  window.addEventListener('click', handleGlobalClick)
})

onUnmounted(() => {
  window.removeEventListener('click', handleGlobalClick)
})

// ===== Inline Folder Rename =====
const isEditingFolder = ref(false)
const editingFolderName = ref('')

function startEditFolder(e) {
  if (e) e.stopPropagation()
  isEditingFolder.value = true
  editingFolderName.value = props.folder.name
  showFolderMenu.value = false
}

function saveFolderTitle(e) {
  if (e) e.stopPropagation()
  const name = editingFolderName.value.trim()
  if (name) {
    emit('rename-folder', props.folder.id, name)
  }
  isEditingFolder.value = false
}

function cancelEditFolder(e) {
  if (e) e.stopPropagation()
  isEditingFolder.value = false
}

// ===== Subfolder Creation =====
const isCreatingSubfolder = ref(false)
const newSubfolderName = ref('')

function startCreateSubfolder(e) {
  if (e) e.stopPropagation()
  if (!props.folder.isExpanded) {
    emit('toggle-folder-expand', props.folder.id)
  }
  isCreatingSubfolder.value = true
  newSubfolderName.value = ''
}

function confirmCreateSubfolder() {
  const name = newSubfolderName.value.trim()
  if (name) {
    emit('create-folder', name, props.folder.id)
  }
  isCreatingSubfolder.value = false
  newSubfolderName.value = ''
}

function cancelCreateSubfolder() {
  isCreatingSubfolder.value = false
  newSubfolderName.value = ''
}

// ===== Inline Chat Rename =====
const editingChatId = ref(null)
const editingChatTitle = ref('')

function getConversationTitle(conv) {
  if (conv.title) return conv.title
  if (conv.messages && conv.messages.length > 0) {
    const firstMsg = conv.messages.find((m) => m.role === 'user')
    if (firstMsg) return firstMsg.content.substring(0, 40) + (firstMsg.content.length > 40 ? '...' : '')
  }
  return 'New Chat'
}

function startEditChat(conv, e) {
  if (e) e.stopPropagation()
  editingChatId.value = conv.id
  editingChatTitle.value = conv.title || getConversationTitle(conv)
  activeChatMenuId.value = null
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

// ===== Drag & Drop =====
function onDragFolderStart(e) {
  const item = { type: 'folder', id: props.folder.id }
  if (e.dataTransfer) {
    e.dataTransfer.setData('text/plain', JSON.stringify(item))
    e.dataTransfer.effectAllowed = 'move'
  }
  emit('drag-start', e, item)
}

function onDragChatStart(e, chatId) {
  const item = { type: 'chat', id: chatId }
  if (e.dataTransfer) {
    e.dataTransfer.setData('text/plain', JSON.stringify(item))
    e.dataTransfer.effectAllowed = 'move'
  }
  emit('drag-start', e, item)
}

function onDragEnd() {
  emit('drag-end')
}

function onDragOver(e) {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  emit('drag-over', e, props.folder.id)
}

function onDragLeave(e) {
  if (e) e.stopPropagation()
  emit('drag-leave', props.folder.id)
}

function onDrop(e) {
  e.preventDefault()
  e.stopPropagation()
  emit('drop', e, props.folder.id)
}

// Check lock state for folder deletion
const hasContents = computed(() => {
  return folderChats.value.length > 0 || childFolders.value.length > 0
})

function handleDelete(e) {
  if (e) e.stopPropagation()
  showFolderMenu.value = false
  emit('delete-folder', props.folder)
}

function getFolderDisplayName(f) {
  const parts = [f.name]
  let curr = f
  while (curr.parentId) {
    const parent = props.allFolders.find((p) => p.id === curr.parentId)
    if (parent) {
      parts.unshift(parent.name)
      curr = parent
    } else {
      break
    }
  }
  return parts.join(' / ')
}
</script>

<template>
  <div
    class="folder-item"
    :class="{
      'folder-item--dragover': dragOverId === folder.id,
      'folder-item--nested': depth > 0,
      'folder-item--menu-open': showFolderMenu || activeChatMenuId,
    }"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- Folder Header -->
    <div
      class="folder-header"
      :class="{ 'folder-header--menu-open': showFolderMenu }"
      draggable="true"
      @dragstart="onDragFolderStart"
      @dragend="onDragEnd"
      @click="$emit('toggle-folder-expand', folder.id)"
    >
      <ChevronRight
        :size="13"
        class="folder-chevron"
        :class="{ 'folder-chevron--expanded': folder.isExpanded }"
      />
      <FolderOpen v-if="folder.isExpanded" :size="15" class="folder-icon folder-icon--open" />
      <Folder v-else :size="15" class="folder-icon" />

      <!-- Inline Rename Folder -->
      <div v-if="isEditingFolder" class="inline-edit-box" @click.stop>
        <input
          v-model="editingFolderName"
          @keydown.enter="saveFolderTitle($event)"
          @keydown.esc="cancelEditFolder($event)"
          class="inline-edit-input"
          autofocus
        />
        <button class="btn-micro btn-micro--confirm" @click="saveFolderTitle($event)" title="Simpan">
          <Check :size="11" />
        </button>
        <button class="btn-micro btn-micro--cancel" @click="cancelEditFolder($event)" title="Batal">
          <X :size="11" />
        </button>
      </div>

      <!-- Normal Folder Meta -->
      <div v-else class="folder-meta">
        <span class="folder-title" :title="folder.name">{{ folder.name }}</span>

        <!-- Trailing area: Count badge (slides right on hover) & Actions (slide in from right) -->
        <div class="folder-trailing" @click.stop>
          <span
            class="folder-count-badge"
            :class="{ 'folder-count-badge--hidden': showFolderMenu }"
          >
            {{ totalChildCount }}
          </span>

          <div
            class="folder-actions"
            :class="{ 'folder-actions--menu-open': showFolderMenu }"
          >
            <!-- Edit folder (outside) -->
            <button
              class="folder-action-btn"
              @click="startEditFolder($event)"
              title="Ubah nama folder"
            >
              <Pencil :size="12" />
            </button>

            <!-- New chat in folder (outside) -->
            <button
              class="folder-action-btn"
              @click="$emit('create-chat', folder.id)"
              title="Chat baru di folder ini"
            >
              <Plus :size="13" />
            </button>

            <!-- Titik Tiga / More (inside: tambah folder, hapus folder) -->
            <div class="more-menu-wrapper">
              <button
                class="folder-action-btn"
                @click="toggleFolderMenu($event)"
                title="Pilihan lainnya"
              >
                <EllipsisVertical :size="13" />
              </button>

              <div v-if="showFolderMenu" class="more-dropdown glass">
                <button
                  class="more-dropdown-option"
                  @click="handleCreateSubfolderClick($event)"
                >
                  <FolderPlus :size="13" />
                  <span>Tambah Folder</span>
                </button>
                <button
                  class="more-dropdown-option more-dropdown-option--danger"
                  :class="{ 'more-dropdown-option--locked': hasContents }"
                  @click="handleDelete($event)"
                  :title="hasContents ? 'Folder masih ada isinya' : 'Hapus folder'"
                >
                  <Trash2 :size="13" />
                  <span>Hapus Folder</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Expanded Contents -->
    <div v-if="folder.isExpanded" class="folder-contents">
      <!-- Inline Subfolder Create Box -->
      <div v-if="isCreatingSubfolder" class="subfolder-create-box">
        <div class="folder-create-input-wrapper">
          <Folder :size="13" class="folder-input-icon" />
          <input
            v-model="newSubfolderName"
            @keydown.enter="confirmCreateSubfolder"
            @keydown.esc="cancelCreateSubfolder"
            placeholder="Nama folder..."
            class="folder-create-input"
            autofocus
          />
        </div>
        <div class="folder-create-actions">
          <button class="btn-micro btn-micro--confirm" @click="confirmCreateSubfolder" title="Buat">
            <Check :size="11" />
          </button>
          <button class="btn-micro btn-micro--cancel" @click="cancelCreateSubfolder" title="Batal">
            <X :size="11" />
          </button>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-if="folderChats.length === 0 && childFolders.length === 0 && !isCreatingSubfolder"
        class="folder-empty-state"
      >
        <span>Folder kosong</span>
      </div>

      <!-- RECURSIVE CHILD SUBFOLDERS -->
      <FolderItem
        v-for="subfolder in childFolders"
        :key="subfolder.id"
        :folder="subfolder"
        :all-folders="allFolders"
        :conversations="conversations"
        :active-id="activeId"
        :depth="depth + 1"
        :drag-over-id="dragOverId"
        @select-chat="$emit('select-chat', $event)"
        @delete-chat="$emit('delete-chat', $event)"
        @rename-chat="(id, title) => $emit('rename-chat', id, title)"
        @create-chat="$emit('create-chat', $event)"
        @create-folder="(name, pId) => $emit('create-folder', name, pId)"
        @rename-folder="(id, name) => $emit('rename-folder', id, name)"
        @delete-folder="$emit('delete-folder', $event)"
        @toggle-folder-expand="$emit('toggle-folder-expand', $event)"
        @move-chat="(cId, fId) => $emit('move-chat', cId, fId)"
        @move-folder="(fId, tId) => $emit('move-folder', fId, tId)"
        @drag-start="(e, item) => $emit('drag-start', e, item)"
        @drag-end="$emit('drag-end')"
        @drag-over="(e, id) => $emit('drag-over', e, id)"
        @drag-leave="$emit('drag-leave', $event)"
        @drop="(e, id) => $emit('drop', e, id)"
      />

      <!-- CHILD CHATS IN THIS FOLDER -->
      <div
        v-for="conv in folderChats"
        :key="conv.id"
        class="conversation-item conversation-item--nested"
        :class="{
          'conversation-item--active': conv.id === activeId,
          'conversation-item--menu-open': activeChatMenuId === conv.id,
        }"
        @click="$emit('select-chat', conv.id)"
        draggable="true"
        @dragstart="onDragChatStart($event, conv.id)"
        @dragend="onDragEnd"
        role="button"
        tabindex="0"
      >
        <!-- Inline Rename Chat -->
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
          <MessageSquare :size="14" class="conv-icon" />
          <span class="conv-title" :title="getConversationTitle(conv)">
            {{ getConversationTitle(conv) }}
          </span>

          <div class="conv-actions" @click.stop>
            <!-- Edit Title (outside) -->
            <button
              class="conv-action-btn"
              @click="startEditChat(conv, $event)"
              title="Edit nama chat"
            >
              <Pencil :size="12" />
            </button>

            <!-- Titik Tiga / More (inside: pindahkan ke folder, hapus chat) -->
            <div class="more-menu-wrapper">
              <button
                class="conv-action-btn"
                @click="toggleChatMenu(conv.id, $event)"
                title="Pilihan lainnya"
              >
                <EllipsisVertical :size="12" />
              </button>

              <div v-if="activeChatMenuId === conv.id" class="more-dropdown glass">
                <button
                  class="more-dropdown-option"
                  @click="toggleMoveSubmenu(conv.id, $event)"
                >
                  <FolderInput :size="13" />
                  <span>Pindahkan ke Folder</span>
                </button>

                <!-- Submenu List of Folders -->
                <div v-if="showMoveSubmenuForChatId === conv.id" class="move-subfolder-list">
                  <button
                    class="move-subfolder-option"
                    @click="handleMoveChat(conv.id, null, $event)"
                  >
                    <span>✕ Keluarkan dari folder</span>
                  </button>
                  <button
                    v-for="f in allFolders"
                    :key="f.id"
                    class="move-subfolder-option"
                    :class="{ 'move-subfolder-option--active': conv.folderId === f.id }"
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
                >
                  <Trash2 :size="13" />
                  <span>Hapus Chat</span>
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.folder-item {
  margin-bottom: 2px;
  border-radius: 8px;
  transition: all 0.15s ease;
}

.folder-item--dragover {
  background: var(--color-accent-subtle) !important;
  outline: 1px dashed var(--color-accent) !important;
}

.folder-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;
  position: relative;
}

.folder-header--menu-open {
  z-index: 80 !important;
}

.folder-item--menu-open {
  position: relative;
  z-index: 80 !important;
}

.conversation-item--menu-open {
  position: relative;
  z-index: 80 !important;
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
  flex: 1;
  min-width: 0;
}

/* Trailing Area: Badge + Actions with Smooth Animation */
.folder-trailing {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 24px;
}

/* Count Indicator Badge: Smoothly moves to the right when hovered */
.folder-count-badge {
  font-size: 0.65rem;
  font-weight: 500;
  color: var(--color-text-muted);
  background: var(--color-bg-tertiary);
  padding: 1px 6px;
  border-radius: 10px;
  flex-shrink: 0;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
  transform: translateX(0);
  opacity: 1;
}

.folder-header:hover .folder-count-badge,
.folder-count-badge--hidden {
  transform: translateX(8px) !important;
  opacity: 0 !important;
  pointer-events: none;
}

/* Actions: Slide in smoothly from right on hover */
.folder-actions {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%) translateX(6px);
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
  white-space: nowrap;
}

.folder-header:hover .folder-actions,
.folder-actions--menu-open {
  transform: translateY(-50%) translateX(0) !important;
  opacity: 1 !important;
  pointer-events: auto !important;
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
  opacity: 0.45;
}

.folder-action-btn--locked:hover {
  color: var(--color-danger);
  background: rgba(239, 68, 68, 0.1);
}

/* Contents & Indentation */
.folder-contents {
  margin-left: 12px;
  padding-left: 6px;
  border-left: 1px solid var(--color-border);
  margin-top: 1px;
  margin-bottom: 3px;
}

.folder-empty-state {
  padding: 5px 8px;
  font-size: 0.72rem;
  color: var(--color-text-muted);
  font-style: italic;
}

/* Subfolder Create Box */
.subfolder-create-box {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 3px 4px 6px;
  padding: 5px 7px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-accent);
  border-radius: 6px;
  box-shadow: 0 0 10px var(--color-accent-glow);
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
  font-size: 0.78rem;
  font-family: var(--font-sans);
  min-width: 0;
}

.folder-create-actions {
  display: flex;
  align-items: center;
  gap: 3px;
}

/* Conversations */
.conversation-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  border-radius: 7px;
  transition: all 0.15s ease;
  text-align: left;
  font-family: var(--font-sans);
  position: relative;
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
  padding: 3px;
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
  font-size: 0.78rem;
  font-family: var(--font-sans);
  border-radius: 5px;
  padding: 2px 6px;
  outline: none;
  min-width: 0;
}

.btn-micro {
  width: 20px;
  height: 20px;
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

/* More Menu (Titik Tiga) Wrapper & Dropdown */
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

.more-dropdown-option--locked {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Submenu for Moving Folder */
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

.move-subfolder-option--active {
  color: var(--color-text-accent);
  font-weight: 600;
}

.move-option-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
