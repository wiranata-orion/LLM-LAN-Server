<script setup>
import { ref, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { Send, Square, Plus, Paperclip, FileText, X } from 'lucide-vue-next'

const props = defineProps({
  disabled: {
    type: Boolean,
    default: false,
  },
  isGenerating: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['send', 'stop'])

const input = ref('')
const textareaRef = ref(null)
const fileInputRef = ref(null)
const showAddMenu = ref(false)
const attachedFiles = ref([])

function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = '36px'
  const maxH = 200
  if (el.scrollHeight > 36) {
    el.style.height = Math.min(el.scrollHeight, maxH) + 'px'
  }
}

onMounted(() => {
  autoResize()
  window.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  window.removeEventListener('click', handleClickOutside)
})

function handleClickOutside(e) {
  if (!e.target.closest('.add-menu-wrapper')) {
    showAddMenu.value = false
  }
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

function toggleAddMenu() {
  showAddMenu.value = !showAddMenu.value
}

function openFilePicker() {
  showAddMenu.value = false
  fileInputRef.value?.click()
}

function handleFileSelect(e) {
  const files = Array.from(e.target.files || [])
  attachedFiles.value.push(...files)
  e.target.value = ''
}

function removeAttachedFile(index) {
  attachedFiles.value.splice(index, 1)
}

function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function sendMessage() {
  const text = input.value.trim()
  if ((!text && attachedFiles.value.length === 0) || props.disabled) return
  emit('send', text, [...attachedFiles.value])
  input.value = ''
  attachedFiles.value = []
  nextTick(autoResize)
}

function stopGeneration() {
  emit('stop')
}

watch(input, () => {
  nextTick(autoResize)
})

function focusInput() {
  textareaRef.value?.focus()
}

defineExpose({ focusInput })
</script>

<template>
  <div class="chat-input-container">
    <!-- Attached Files Preview -->
    <div v-if="attachedFiles.length" class="attached-files-row">
      <div v-for="(file, index) in attachedFiles" :key="`${file.name}-${index}`" class="attached-file-chip glass">
        <FileText :size="13" class="attached-file-icon" />
        <span class="attached-file-name" :title="file.name">{{ file.name }}</span>
        <span class="attached-file-size">{{ formatFileSize(file.size) }}</span>
        <button class="attached-file-remove" @click="removeAttachedFile(index)" title="Hapus lampiran">
          <X :size="12" />
        </button>
      </div>
    </div>

    <div class="chat-input-wrapper glass glow-accent">
      <!-- "+" Add Menu (attach files, etc.) -->
      <div class="add-menu-wrapper">
        <button
          class="add-btn"
          @click="toggleAddMenu"
          title="Tambah"
          id="add-menu-btn"
          type="button"
        >
          <Plus :size="18" />
        </button>

        <Transition name="fade">
          <div v-if="showAddMenu" class="add-menu glass">
            <button class="add-menu-option" @click="openFilePicker" type="button">
              <Paperclip :size="14" />
              <span>Pilih File</span>
            </button>
          </div>
        </Transition>

        <input
          ref="fileInputRef"
          type="file"
          multiple
          class="file-hidden-input"
          accept=".txt,.md,.markdown,.csv,.json,.log,.js,.ts,.jsx,.tsx,.py,.html,.css,.yml,.yaml,.xml"
          @change="handleFileSelect"
        />
      </div>

      <textarea
        ref="textareaRef"
        v-model="input"
        @keydown="handleKeydown"
        :placeholder="isGenerating ? 'AI sedang merespons...' : 'Ketik pesan...'"
        :disabled="disabled && !isGenerating"
        rows="1"
        class="chat-textarea"
        id="chat-input"
      ></textarea>

      <div class="chat-input-actions">
        <button
          v-if="isGenerating"
          @click="stopGeneration"
          class="send-btn stop-btn"
          title="Stop generating"
          id="stop-btn"
        >
          <Square :size="18" fill="currentColor" />
        </button>
        <button
          v-else
          @click="sendMessage"
          :disabled="(!input.trim() && attachedFiles.length === 0) || disabled"
          class="send-btn"
          :class="{ 'send-btn--active': (input.trim() || attachedFiles.length) && !disabled }"
          title="Send message (Enter)"
          id="send-btn"
        >
          <Send :size="18" />
        </button>
      </div>
    </div>

    <p class="chat-input-hint">
      <kbd>Enter</kbd> kirim · <kbd>Shift+Enter</kbd> baris baru
    </p>
  </div>
</template>

<style scoped>
.chat-input-container {
  padding: 0 24px 20px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
}

/* Attached Files Preview Row */
.attached-files-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.attached-file-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px 5px 10px;
  border-radius: 8px;
  font-size: 0.74rem;
  color: var(--color-text-secondary);
  max-width: 220px;
}

.attached-file-icon {
  color: var(--color-text-accent);
  flex-shrink: 0;
}

.attached-file-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}

.attached-file-size {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.attached-file-remove {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  flex-shrink: 0;
}

.attached-file-remove:hover {
  color: var(--color-danger);
  background: rgba(239, 68, 68, 0.12);
}

/* "+" Add Menu */
.add-menu-wrapper {
  position: relative;
  flex-shrink: 0;
}

.add-btn {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  border: none;
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  margin-bottom: 2px;
}

.add-btn:hover {
  background: var(--color-accent-subtle);
  color: var(--color-text-accent);
}

.add-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  min-width: 160px;
  border-radius: 10px;
  padding: 5px;
  z-index: 40;
}

.add-menu-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-family: var(--font-sans);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.add-menu-option:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.file-hidden-input {
  display: none;
}

.chat-input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 8px 8px 8px 16px;
  border-radius: 20px;
  min-height: 52px;
  box-sizing: border-box;
  transition: border-color 0.2s ease, box-shadow 0.25s ease;
}

.chat-input-wrapper:focus-within {
  box-shadow: 0 0 24px var(--color-accent-glow), 0 0 80px var(--color-accent-subtle);
  border-color: var(--color-accent) !important;
}

.chat-textarea {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--color-text-primary);
  font-size: 0.95rem;
  line-height: 24px;
  resize: none;
  min-height: 36px;
  max-height: 200px;
  padding: 6px 0;
  margin: 0;
  font-family: var(--font-sans);
  box-sizing: border-box;
}

.chat-textarea::placeholder {
  color: var(--color-text-muted);
}

.chat-textarea:disabled {
  opacity: 0.5;
}

.chat-input-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
}

.send-btn {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: none;
  background: var(--color-bg-hover);
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.send-btn svg {
  margin-left: 2px;
}

.stop-btn svg {
  margin-left: 0;
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-btn--active {
  background: var(--color-accent);
  color: var(--color-on-accent, white);
  box-shadow: 0 0 16px var(--color-accent-glow);
}

.send-btn--active:hover {
  background: var(--color-accent-hover);
  transform: scale(1.05);
}

.stop-btn {
  background: var(--color-danger);
  color: var(--color-on-accent, white);
  animation: pulse 1.5s infinite;
}

.stop-btn:hover {
  background: #dc2626;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
  50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
}

.chat-input-hint {
  text-align: center;
  font-size: 0.72rem;
  color: var(--color-text-muted);
  margin: 8px 0 0;
}

.chat-input-hint kbd {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: 1px 5px;
  font-family: var(--font-sans);
  font-size: 0.65rem;
}

@media (max-width: 768px) {
  .chat-input-container {
    padding: 0 12px 12px;
  }
}
</style>
