<script setup>
import { ref, nextTick, watch, onMounted, computed } from 'vue'
import MessageBubble from './MessageBubble.vue'
import ChatInput from './ChatInput.vue'
import { Bot, Sparkles, Cpu, Zap, Copy, Check, RefreshCw } from 'lucide-vue-next'

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
})

const emit = defineEmits(['send', 'stop', 'regenerate'])

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
})

function handleSend(text) {
  emit('send', text)
}

function handleStop() {
  emit('stop')
}

const features = [
  { icon: Sparkles, title: 'Streaming Response', desc: 'Respons real-time kata per kata' },
  { icon: Cpu, title: 'Local & Private', desc: 'Berjalan di lokal tanpa internet' },
  { icon: Zap, title: 'Multi Model', desc: 'Model sesuai kebutuhan' },
]

const copied = ref(false)
function copyContent(text) {
  navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => copied.value = false, 2000)
}

function emitRegenerate() {
  emit('regenerate')
}
</script>

<template>
  <div class="chat-view">
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
        <div class="message-row" v-for="(msg, i) in messages" :key="i">
          <MessageBubble :message="msg" />
          
          <div v-if="msg.role === 'assistant'" class="message-actions">
            <button class="action-btn" @click="copyContent(msg.content)" :title="copied ? 'Copied!' : 'Copy response'">
              <Check v-if="copied" :size="14" />
              <Copy v-else :size="14" />
              <span>{{ copied ? 'Copied' : 'Copy' }}</span>
            </button>
            <button v-if="i === messages.length - 1" class="action-btn" @click="emitRegenerate" title="Regenerate response" :disabled="isGenerating" :class="{ 'action-btn--disabled': isGenerating }">
              <RefreshCw :size="14" />
              <span>Regenerate</span>
            </button>
            <span class="model-label" v-if="msg.model">{{ msg.model }}</span>
          </div>
        </div>

        <!-- Typing Indicator -->
        <div v-if="showPlaceholder" class="placeholder-bubble"></div>
      </template>
    </div>

    <!-- Input Area -->
    <ChatInput
      ref="chatInputRef"
      :disabled="isGenerating"
      :is-generating="isGenerating"
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
  background: linear-gradient(135deg, var(--color-accent), #6d28d9);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
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
  background: var(--color-placeholder, #e0e0e0);
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

.message-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px 28px;
  max-width: 860px;
  margin: 0 auto;
  width: 100%;
}

.message-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 12px;
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

.model-label {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin-left: 8px;
  opacity: 0.7;
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
