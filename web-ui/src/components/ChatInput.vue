<script setup>
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { Send, Square, Plus, Paperclip, FileText, X, Image as ImageIcon, Slash, Mic } from 'lucide-vue-next'
import { getPromptTemplates } from '../services/promptTemplates.js'
import { isSttSupported, createSpeechRecognizer } from '../services/speech.js'

const props = defineProps({
  disabled: {
    type: Boolean,
    default: false,
  },
  isGenerating: {
    type: Boolean,
    default: false,
  },
  // Whether the currently selected model can take image input - see App.vue's
  // updateModelVisionSupport. False hides the "Upload Gambar" option
  // entirely, instead of letting the user attach an image the model will
  // just reject once the request reaches Ollama.
  supportsImages: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['send', 'stop'])

const input = ref('')
const textareaRef = ref(null)
const fileInputRef = ref(null)
const imageInputRef = ref(null)
const showAddMenu = ref(false)
const attachedFiles = ref([])
// { file, previewUrl } - previewUrl is a local object URL for the thumbnail
// only; the actual base64/resize conversion happens in App.vue right before
// sending (see image.js), not here, so this component stays UI-only.
const attachedImages = ref([])

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
  if (!e.target.closest('.slash-menu') && !e.target.closest('#chat-input')) {
    slashQuery.value = null
  }
}

// ===== "/" quick-template picker (#8) - see promptTemplates.js =====
// null = not composing a command; a string (possibly empty) = the partial
// trigger typed so far. Unlike WorkspaceChatPanel's "@" mentions, a slash
// command only ever means anything when it's the ENTIRE message typed so
// far (position 0 to the end) - so this only needs the input's full value,
// never the caret position.
const slashQuery = ref(null)
const slashIndex = ref(0)

const slashMatchList = computed(() => {
  if (slashQuery.value === null) return []
  const query = slashQuery.value.toLowerCase()
  return getPromptTemplates()
    .filter((template) => !query || template.trigger.toLowerCase().includes(query))
    .slice(0, 8)
})

function updateSlashState() {
  const match = input.value.match(/^\/([a-zA-Z0-9_-]*)$/)
  const nextQuery = match ? match[1] : null
  if (nextQuery !== slashQuery.value) slashIndex.value = 0
  slashQuery.value = nextQuery
}

watch(input, updateSlashState)

function moveSlashSelection(delta) {
  const lastIndex = slashMatchList.value.length - 1
  slashIndex.value = Math.min(lastIndex, Math.max(0, slashIndex.value + delta))
}

function applySlashTemplate(template) {
  input.value = template.text
  slashQuery.value = null
  nextTick(() => {
    autoResize()
    const el = textareaRef.value
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
}

function handleKeydown(e) {
  if (slashQuery.value !== null && slashMatchList.value.length) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveSlashSelection(1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveSlashSelection(-1)
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      applySlashTemplate(slashMatchList.value[slashIndex.value])
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      slashQuery.value = null
      return
    }
  }

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

function openImagePicker() {
  showAddMenu.value = false
  imageInputRef.value?.click()
}

function handleFileSelect(e) {
  const files = Array.from(e.target.files || [])
  attachedFiles.value.push(...files)
  e.target.value = ''
}

function handleImageSelect(e) {
  const files = Array.from(e.target.files || [])
  for (const file of files) {
    attachedImages.value.push({ file, previewUrl: URL.createObjectURL(file) })
  }
  e.target.value = ''
}

function removeAttachedFile(index) {
  attachedFiles.value.splice(index, 1)
}

function removeAttachedImage(index) {
  URL.revokeObjectURL(attachedImages.value[index].previewUrl)
  attachedImages.value.splice(index, 1)
}

// Switching to a model without vision support while images are still staged
// (attached, then the user picked a different model before sending) must
// not silently carry them into the next send - that's exactly the request
// Ollama rejects (see ollama.ts's parseError "image input is not supported").
watch(() => props.supportsImages, (supported) => {
  if (supported || !attachedImages.value.length) return
  for (const image of attachedImages.value) URL.revokeObjectURL(image.previewUrl)
  attachedImages.value = []
})

function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function sendMessage() {
  const text = input.value.trim()
  if ((!text && attachedFiles.value.length === 0 && attachedImages.value.length === 0) || props.disabled) return
  emit('send', text, [...attachedFiles.value], attachedImages.value.map((i) => i.file))
  input.value = ''
  attachedFiles.value = []
  for (const image of attachedImages.value) URL.revokeObjectURL(image.previewUrl)
  attachedImages.value = []
  nextTick(autoResize)
}

function stopGeneration() {
  emit('stop')
}

// ===== Speech-to-text (#1) - see services/speech.js =====
const sttSupported = isSttSupported()
const isListening = ref(false)
let recognizer = null
// The composer's own text before this listening session started, plus
// whatever's been finalized so far within it - onResult below always
// rewrites input.value as (base + finalized + latest interim), rather than
// appending piecemeal, since SpeechRecognition re-sends an in-progress
// phrase's interim transcript repeatedly until it finalizes.
let sttBaseText = ''
let sttFinalizedText = ''

function toggleListening() {
  if (isListening.value) {
    recognizer?.stop()
    return
  }
  recognizer = createSpeechRecognizer({
    onResult: (transcript, isFinal) => {
      if (isFinal) sttFinalizedText += transcript
      input.value = `${sttBaseText}${sttFinalizedText}${isFinal ? '' : transcript}`.trim()
    },
    onEnd: () => {
      isListening.value = false
    },
    onError: () => {
      isListening.value = false
    },
  })
  if (!recognizer) return
  sttBaseText = input.value ? `${input.value} ` : ''
  sttFinalizedText = ''
  isListening.value = true
  recognizer.start()
}

onUnmounted(() => {
  recognizer?.stop()
})

watch(input, () => {
  nextTick(autoResize)
})

function focusInput() {
  textareaRef.value?.focus()
}

/**
 * Puts text back into the composer - used when a just-sent prompt fails to
 * get a reply (error, connection lost, etc.) so the user doesn't have to
 * retype it to retry. Only restores the typed text, not any attached files
 * (those were already handed off to ingestAttachedFiles by the time a
 * failure could happen further down the pipeline).
 */
function restoreDraft(text) {
  input.value = text
  nextTick(() => {
    autoResize()
    focusInput()
  })
}

defineExpose({ focusInput, restoreDraft })
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

    <!-- Attached Images Preview -->
    <div v-if="attachedImages.length" class="attached-images-row">
      <div v-for="(image, index) in attachedImages" :key="`${image.file.name}-${index}`" class="attached-image-thumb">
        <img :src="image.previewUrl" :alt="image.file.name" />
        <button class="attached-image-remove" @click="removeAttachedImage(index)" title="Hapus gambar">
          <X :size="12" />
        </button>
      </div>
    </div>

    <!-- "/" quick-template picker (#8) -->
    <div v-if="slashQuery !== null && slashMatchList.length" class="slash-menu glass">
      <button
        v-for="(template, index) in slashMatchList"
        :key="template.trigger"
        class="slash-menu-item"
        :class="{ 'slash-menu-item--active': index === slashIndex }"
        type="button"
        @mousedown.prevent="applySlashTemplate(template)"
      >
        <Slash :size="12" class="slash-menu-icon" />
        <span class="slash-menu-trigger">/{{ template.trigger }}</span>
        <span class="slash-menu-label">{{ template.label }}</span>
      </button>
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
            <button v-if="supportsImages" class="add-menu-option" @click="openImagePicker" type="button">
              <ImageIcon :size="14" />
              <span>Upload Gambar</span>
            </button>
          </div>
        </Transition>

        <input
          ref="fileInputRef"
          type="file"
          multiple
          class="file-hidden-input"
          accept=".txt,.md,.markdown,.csv,.json,.log,.js,.ts,.jsx,.tsx,.py,.html,.css,.yml,.yaml,.xml,.pdf,.docx,.xlsx,.xls"
          @change="handleFileSelect"
        />
        <input
          v-if="supportsImages"
          ref="imageInputRef"
          type="file"
          multiple
          class="file-hidden-input"
          accept="image/png,image/jpeg,image/webp,image/gif"
          @change="handleImageSelect"
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
          v-if="sttSupported"
          class="mic-btn"
          :class="{ 'mic-btn--listening': isListening }"
          type="button"
          :title="isListening ? 'Berhenti merekam' : 'Bicara untuk mengetik (STT)'"
          @click="toggleListening"
        >
          <Mic :size="16" />
        </button>
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
          :disabled="(!input.trim() && attachedFiles.length === 0 && attachedImages.length === 0) || disabled"
          class="send-btn"
          :class="{ 'send-btn--active': (input.trim() || attachedFiles.length || attachedImages.length) && !disabled }"
          title="Send message (Enter)"
          id="send-btn"
        >
          <Send :size="18" />
        </button>
      </div>
    </div>

    <p class="chat-input-hint">
      <kbd>/</kbd> template · <kbd>Enter</kbd> kirim · <kbd>Shift+Enter</kbd> baris baru
    </p>
  </div>
</template>

<style scoped>
.chat-input-container {
  position: relative;
  padding: 0 24px 20px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
}

/* "/" quick-template picker */
.slash-menu {
  position: absolute;
  bottom: calc(100% - 12px);
  left: 24px;
  right: 24px;
  max-height: 240px;
  overflow-y: auto;
  border-radius: 10px;
  padding: 5px;
  z-index: 40;
}

.slash-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-family: var(--font-sans);
  text-align: left;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.slash-menu-icon {
  flex-shrink: 0;
  color: var(--color-text-accent);
}

.slash-menu-trigger {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--color-text-accent);
  flex-shrink: 0;
}

.slash-menu-label {
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slash-menu-item:hover,
.slash-menu-item--active {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
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

/* Attached Images Preview Row */
.attached-images-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.attached-image-thumb {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--color-border);
}

.attached-image-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.attached-image-remove {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.65);
  border: none;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.attached-image-remove:hover {
  background: var(--color-danger);
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
  gap: 6px;
  height: 36px;
}

.mic-btn {
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

.mic-btn:hover {
  color: var(--color-text-accent);
  background: var(--color-accent-subtle);
}

.mic-btn--listening {
  background: var(--color-danger, #ef4444);
  color: white;
  animation: pulse 1.5s infinite;
}

.mic-btn--listening:hover {
  background: #dc2626;
  color: white;
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
