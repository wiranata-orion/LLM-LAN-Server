<script setup>
import { ref, nextTick, watch, onMounted, onUnmounted, computed } from 'vue'
import MessageBubble from './MessageBubble.vue'
import ChatInput from './ChatInput.vue'
import SelectionActionPopover from './SelectionActionPopover.vue'
import { Bot, Sparkles, Cpu, Zap, Copy, Check, RefreshCw, ThumbsUp, ThumbsDown, Gauge } from 'lucide-vue-next'
import { getModelDisplayName, formatDuration, perfSummary, perfTooltip } from '../services/api.js'

const props = defineProps({
  messages: {
    type: Array,
    default: () => [],
  },
  isGenerating: {
    type: Boolean,
    default: false,
  },
  modelName: {
    type: String,
    default: '',
  },
  // The active conversation's id - only forwarded to MessageBubble so it can
  // check whether each of its own messages is already pinned (see
  // pinnedNotes.js / App.vue's handlePinMessage).
  conversationId: {
    type: String,
    default: '',
  },
  // Whether the selected model declares Ollama's "vision" capability - see
  // App.vue's updateModelVisionSupport. Forwarded straight to ChatInput,
  // which hides the "Upload Gambar" option entirely when this is false.
  supportsImages: {
    type: Boolean,
    default: false,
  },
  generationElapsedSeconds: {
    type: Number,
    default: 0,
  },
})

const emit = defineEmits(['send', 'stop', 'regenerate', 'rate-message', 'edit-message', 'switch-branch', 'clarify-submit', 'pin-message'])

function isMessageStreaming(index) {
  return props.isGenerating && index === props.messages.length - 1
}

// A rating is final. `:disabled` on the buttons already prevents this from
// firing once one is picked, but that's a presentation detail - this guard is
// the real source of truth, so a rating can never change no matter what UI
// state (a stale disabled binding, a race with a data reload, anything else)
// let the click through.
function emitRate(index, rating) {
  if (props.messages[index]?.rating) return
  emit('rate-message', index, rating)
}

// MessageBubble only knows its own message, not its index in the
// conversation - App.vue's handleEditMessage/handleSwitchBranch need that
// index to find the right node in the tree, so it's attached here.
function emitEditMessage(index, newText) {
  emit('edit-message', index, newText)
}

function emitSwitchBranch(index, delta) {
  emit('switch-branch', index, delta)
}

function emitClarifySubmit(payload) {
  emit('clarify-submit', payload)
}

function emitPinMessage(index) {
  emit('pin-message', index)
}

// ===== Code Explainer "Hover & Highlight" (#5) =====
// Selecting text/code inside an ASSISTANT reply shows a small floating
// popover with quick actions; picking one sends a follow-up prompt built
// from the selected text through the normal send pipeline - see
// handleSelectionAction below and App.vue's plain sendMessage().
const selectionPopover = ref({ visible: false, x: 0, y: 0, text: '' })

function updateSelectionPopover() {
  const selection = window.getSelection()
  const text = selection?.toString().trim()
  if (!text || !selection.rangeCount) {
    selectionPopover.value = { ...selectionPopover.value, visible: false }
    return
  }

  // Only for a selection actually inside an assistant bubble in THIS
  // ChatView instance - not the composer, not a user message, not some
  // unrelated text elsewhere on the page (e.g. the sidebar).
  const anchorElement = selection.anchorNode?.nodeType === Node.TEXT_NODE
    ? selection.anchorNode.parentElement
    : selection.anchorNode
  const assistantBubble = anchorElement?.closest?.('.message-row--assistant .message-bubble--assistant')
  if (!assistantBubble || !messagesContainer.value?.contains(assistantBubble)) {
    selectionPopover.value = { ...selectionPopover.value, visible: false }
    return
  }

  const rect = selection.getRangeAt(0).getBoundingClientRect()
  selectionPopover.value = { visible: true, x: rect.left + rect.width / 2, y: rect.top, text }
}

function hideSelectionPopover() {
  selectionPopover.value = { ...selectionPopover.value, visible: false }
}

const SELECTION_ACTION_PROMPTS = {
  explain: 'Jelaskan bagian berikut secara detail:',
  'find-bugs': 'Cari kemungkinan bug atau kesalahan pada bagian berikut, dan jelaskan cara memperbaikinya:',
  refactor: 'Refactor bagian berikut agar lebih bersih dan mudah dibaca, tanpa mengubah perilakunya:',
  optimize: 'Optimalkan performa bagian berikut dan jelaskan trade-off dari setiap perubahan:',
}

function handleSelectionAction(actionId) {
  const text = selectionPopover.value.text
  hideSelectionPopover()
  window.getSelection()?.removeAllRanges()
  if (!text) return
  const prompt = SELECTION_ACTION_PROMPTS[actionId] || SELECTION_ACTION_PROMPTS.explain
  emit('send', `${prompt}\n\n\`\`\`\n${text}\n\`\`\``, [], [])
}

const messagesContainer = ref(null)
const userScrolling = ref(false)
const chatInputRef = ref(null)

// Show placeholder bubble while AI is generating and no assistant message yet
const showPlaceholder = computed(() => {
  return props.isGenerating && (
    props.messages.length === 0 ||
    props.messages[props.messages.length - 1].role !== 'assistant'
  )
})

function scrollToBottom() {
  if (userScrolling.value) return
  nextTick(() => {
    const el = messagesContainer.value
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
    }
  })
}

function onScroll() {
  const el = messagesContainer.value
  if (!el) return
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
  userScrolling.value = !atBottom
  hideSelectionPopover() // the popover is positioned in fixed viewport coords, so it would drift away from the actual selection on scroll
}

watch(
  () => props.messages,
  () => {
    const el = messagesContainer.value
    if (el) {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
      if (atBottom) userScrolling.value = false
    }
    scrollToBottom()
  },
  { deep: true }
)

onMounted(() => {
  chatInputRef.value?.focusInput()
  document.addEventListener('selectionchange', updateSelectionPopover)
})

onUnmounted(() => {
  document.removeEventListener('selectionchange', updateSelectionPopover)
})

function handleSend(text, files, images) {
  emit('send', text, files, images)
}

function handleStop() {
  emit('stop')
}

/** Forwarded to the composer - see ChatInput.vue's restoreDraft. */
function restoreDraft(text) {
  chatInputRef.value?.restoreDraft(text)
}

defineExpose({ restoreDraft })

const features = [
  { icon: Sparkles, title: 'Streaming Response', desc: 'Respons real-time kata per kata' },
  { icon: Cpu, title: 'Local & Private', desc: 'Berjalan di lokal tanpa internet' },
  { icon: Zap, title: 'Multi Model', desc: 'Model sesuai kebutuhan' },
]

// Tracks which message's Copy button most recently succeeded, so only that
// one button flips to "Copied" instead of every Copy button at once.
const copiedIndex = ref(null)
function copyContent(text, index) {
  navigator.clipboard.writeText(text)
  copiedIndex.value = index
  setTimeout(() => {
    if (copiedIndex.value === index) copiedIndex.value = null
  }, 2000)
}

function emitRegenerate() {
  emit('regenerate')
}
</script>

<template>
  <div class="chat-view">
    <!-- Code Explainer "Hover & Highlight" (#5) - floats above whatever text is currently selected in an assistant reply. -->
    <SelectionActionPopover
      v-if="selectionPopover.visible"
      :x="selectionPopover.x"
      :y="selectionPopover.y"
      @action="handleSelectionAction"
    />

    <!-- Messages Area -->
    <div ref="messagesContainer" class="messages-area" @scroll="onScroll">
      <!-- Welcome Screen -->
      <div v-if="messages.length === 0" class="welcome-screen">
        <div class="welcome-icon-wrapper">
          <div class="welcome-icon">
            <Bot :size="36" />
          </div>
        </div>
        <h1 class="welcome-title">Xufruz Local LLM</h1>

        <div class="feature-cards">
          <div v-for="f in features" :key="f.title" class="feature-card glass">
            <component :is="f.icon" :size="20" class="feature-icon" />
            <h3>{{ f.title }}</h3>
            <p>{{ f.desc }}</p>
          </div>
        </div>
      </div>

      <!-- Messages -->
      <template v-else>
        <!-- Keyed by message id (not index) once messageTree.js has assigned
             one - switching branches or editing a message replaces this
             array's contents outright (see syncActivePath), and an
             index-based key would let Vue reuse the wrong MessageBubble
             instance (and its local isEditing state) across that swap. -->
        <template v-for="(msg, i) in messages" :key="msg.id || i">
          <div class="message-item">
            <MessageBubble
              :message="msg"
              :is-generating="isMessageStreaming(i)"
              :elapsed-seconds="generationElapsedSeconds"
              :conversation-id="conversationId"
              @edit="emitEditMessage(i, $event)"
              @switch-branch="emitSwitchBranch(i, $event)"
              @clarify-submit="emitClarifySubmit"
              @pin="emitPinMessage(i)"
            />

            <!-- Actions settle in only once this reply has fully finished. -->
            <div v-if="msg.role === 'assistant' && !isMessageStreaming(i)" class="message-actions">
              <button class="action-btn" @click="copyContent(msg.content, i)" :title="copiedIndex === i ? 'Copied!' : 'Copy response'">
                <Check v-if="copiedIndex === i" :size="14" />
                <Copy v-else :size="14" />
                <span>{{ copiedIndex === i ? 'Copied' : 'Copy' }}</span>
              </button>
              <button v-if="i === messages.length - 1" class="action-btn" @click="emitRegenerate" title="Regenerate response" :disabled="isGenerating" :class="{ 'action-btn--disabled': isGenerating }">
                <RefreshCw :size="14" />
                <span>Regenerate</span>
              </button>

              <div class="rating-buttons" role="group" aria-label="Nilai jawaban ini">
                <button
                  class="rating-btn"
                  :class="{
                    'rating-btn--active rating-btn--yes': msg.rating === 'good',
                    'rating-btn--locked': msg.rating && msg.rating !== 'good',
                  }"
                  :disabled="!!msg.rating"
                  @click="emitRate(i, 'good')"
                  :title="msg.rating ? 'Penilaian sudah dikunci' : 'Jawaban ini sudah sesuai'"
                >
                  <ThumbsUp :size="13" />
                  <span>Yes</span>
                </button>
                <button
                  class="rating-btn"
                  :class="{
                    'rating-btn--active rating-btn--no': msg.rating === 'bad',
                    'rating-btn--locked': msg.rating && msg.rating !== 'bad',
                  }"
                  :disabled="!!msg.rating"
                  @click="emitRate(i, 'bad')"
                  :title="msg.rating ? 'Penilaian sudah dikunci' : 'Jawaban ini kurang sesuai'"
                >
                  <ThumbsDown :size="13" />
                  <span>No</span>
                </button>
              </div>

              <div class="message-meta">
                <span v-if="msg.durationMs" class="duration-label" :title="`Waktu respons: ${formatDuration(msg.durationMs)}`">{{ formatDuration(msg.durationMs) }}</span>
                <span
                  v-if="perfSummary(msg.performance)"
                  class="perf-label"
                  :title="perfTooltip(msg.performance)"
                >
                  <Gauge :size="11" />
                  {{ perfSummary(msg.performance) }}
                </span>
                <span class="model-label" v-if="msg.model" :title="msg.model">{{ getModelDisplayName(msg.model) }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- Typing Indicator -->
        <div v-if="showPlaceholder" class="placeholder-bubble"></div>
      </template>
    </div>

    <!-- Input Area -->
    <ChatInput
      ref="chatInputRef"
      :disabled="isGenerating"
      :is-generating="isGenerating"
      :supports-images="supportsImages"
      @send="handleSend"
      @stop="handleStop"
    />
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.messages-area {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0;
}

.welcome-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 40px 24px;
  animation: fadeIn 0.6s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.welcome-icon-wrapper {
  margin-bottom: 20px;
}

.welcome-icon {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-on-accent, white);
  box-shadow: 0 0 40px var(--color-accent-glow);
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

.welcome-title {
  font-size: 2rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 8px;
  letter-spacing: -0.02em;
}

/* Placeholder bubble animation */
.placeholder-bubble {
  height: 60px;
  max-width: 600px;
  margin: 0 auto 12px;
  border-radius: 12px;
  background: var(--color-bg-tertiary);
  position: relative;
  overflow: hidden;
}
.placeholder-bubble::after {
  content: '';
  position: absolute;
  top: 0;
  left: -150%;
  width: 150%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
  animation: loading-shimmer 1.5s infinite;
}
@keyframes loading-shimmer {
  0% { transform: translateX(0); }
  100% { transform: translateX(100%); }
}

.feature-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  max-width: 640px;
  width: 100%;
}

.feature-card {
  padding: 20px;
  border-radius: 14px;
  text-align: center;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.feature-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.feature-icon {
  color: var(--color-accent);
  margin-bottom: 10px;
}

.feature-card h3 {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}

.feature-card p {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin: 0;
  line-height: 1.4;
}

.message-item {
  max-width: 860px;
  margin: 0 auto;
  width: 100%;
}

.message-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 24px 12px 68px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.message-item:hover .message-actions,
.message-item:focus-within .message-actions {
  opacity: 1;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 0.75rem;
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn--disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
}

.rating-buttons {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 4px;
  margin-left: 4px;
  border-left: 1px solid var(--color-border);
}

.rating-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 0.75rem;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.rating-btn:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-light);
  background: var(--color-bg-hover);
}

/* Confirmed choice: solid fill + a one-time pop so the click clearly registers. */
.rating-btn--active {
  cursor: default;
  animation: ratingConfirm 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.rating-btn--active.rating-btn--yes {
  color: white;
  border-color: var(--color-success, #22c55e);
  background: var(--color-success, #22c55e);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success, #22c55e) 25%, transparent);
}

.rating-btn--active.rating-btn--no {
  color: white;
  border-color: var(--color-danger, #ef4444);
  background: var(--color-danger, #ef4444);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-danger, #ef4444) 25%, transparent);
}

/* A locked-in button must look and feel identical whether hovered or not -
   nothing about it should suggest it's still interactive. */
.rating-btn--active.rating-btn--yes:hover {
  color: white;
  background: var(--color-success, #22c55e);
  border-color: var(--color-success, #22c55e);
}

.rating-btn--active.rating-btn--no:hover {
  color: white;
  background: var(--color-danger, #ef4444);
  border-color: var(--color-danger, #ef4444);
}

@keyframes ratingConfirm {
  0% { transform: scale(1); }
  50% { transform: scale(1.22); }
  100% { transform: scale(1); }
}

/* The button not chosen fades out once a rating is locked in, so it's obvious
   at a glance which one was picked and that it can no longer be changed. */
.rating-btn--locked {
  opacity: 0.3;
  cursor: not-allowed;
}

.rating-btn--locked:hover {
  background: none;
  border-color: var(--color-border);
  color: var(--color-text-muted);
}


.message-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.duration-label {
  font-size: 0.72rem;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  opacity: 0.8;
}

.perf-label {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.72rem;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  opacity: 0.8;
  cursor: default;
}

.model-label {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.typing-indicator-row {
  padding: 12px 24px;
  max-width: 860px;
  margin: 0 auto;
  width: 100%;
}

.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 12px 16px;
  background: var(--color-bg-tertiary);
  border-radius: 12px;
  width: fit-content;
}

@media (max-width: 768px) {
  .feature-cards {
    grid-template-columns: 1fr;
    max-width: 300px;
  }

  .welcome-title {
    font-size: 1.5rem;
  }

  .welcome-screen {
    padding: 24px 16px;
  }
}
</style>
