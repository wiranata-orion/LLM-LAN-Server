<script setup>
import { ref, nextTick, watch, onMounted } from 'vue'
import { Send, Square } from 'lucide-vue-next'

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
})

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

function sendMessage() {
  const text = input.value.trim()
  if (!text || props.disabled) return
  emit('send', text)
  input.value = ''
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
    <div class="chat-input-wrapper glass glow-accent">
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
          :disabled="!input.trim() || disabled"
          class="send-btn"
          :class="{ 'send-btn--active': input.trim() && !disabled }"
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
  box-shadow: 0 0 24px var(--color-accent-glow), 0 0 80px rgba(139, 92, 246, 0.1);
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
  color: white;
  box-shadow: 0 0 16px var(--color-accent-glow);
}

.send-btn--active:hover {
  background: var(--color-accent-hover);
  transform: scale(1.05);
}

.stop-btn {
  background: var(--color-danger);
  color: white;
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
