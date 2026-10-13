<script setup>
import { ref, computed, watch } from 'vue'
import { BrainCircuit, ChevronDown, Copy, Check, Sparkles } from 'lucide-vue-next'
import { renderMarkdown } from '../services/markdownRenderer.js'

const props = defineProps({
  thought: {
    type: String,
    default: '',
  },
  isThinking: {
    type: Boolean,
    default: false,
  },
  wordCount: {
    type: Number,
    default: 0,
  },
  isGenerating: {
    type: Boolean,
    default: false,
  },
})

// Auto-expand while thinking so user sees reasoning live; collapse by default when thinking completes
const isExpanded = ref(props.isThinking)
const userToggled = ref(false)
const copied = ref(false)

watch(
  () => props.isThinking,
  (thinking, wasThinking) => {
    if (!userToggled.value) {
      if (thinking) {
        isExpanded.value = true
      } else if (wasThinking && !thinking) {
        // Finished thinking
        isExpanded.value = false
      }
    }
  },
  { immediate: true },
)

function toggleExpand() {
  userToggled.value = true
  isExpanded.value = !isExpanded.value
}

async function copyThought(e) {
  e.stopPropagation()
  if (!props.thought) return
  try {
    await navigator.clipboard.writeText(props.thought)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 1600)
  } catch (err) {
    console.error('Failed to copy reasoning:', err)
  }
}

const renderedThought = computed(() => {
  return renderMarkdown(props.thought || '')
})

const displayWordCount = computed(() => {
  if (props.wordCount) return props.wordCount
  const trimmed = (props.thought || '').trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
})
</script>

<template>
  <div
    class="reasoning-block"
    :class="{
      'reasoning-block--active': isThinking,
      'reasoning-block--expanded': isExpanded,
    }"
  >
    <!-- Header Row (Clickable) -->
    <div
      class="reasoning-header"
      role="button"
      tabindex="0"
      :aria-expanded="isExpanded"
      @click="toggleExpand"
      @keydown.enter.space.prevent="toggleExpand"
    >
      <div class="reasoning-header-left">
        <div class="reasoning-icon-wrapper" :class="{ 'reasoning-icon-wrapper--pulse': isThinking }">
          <BrainCircuit v-if="!isThinking" :size="15" class="reasoning-icon" />
          <Sparkles v-else :size="15" class="reasoning-icon reasoning-icon--sparkle" />
        </div>

        <span class="reasoning-title">
          {{ isThinking ? 'Sedang Berpikir...' : 'Proses Berpikir (Chain of Thought)' }}
        </span>

        <span v-if="isThinking" class="reasoning-badge reasoning-badge--live">
          <span class="pulse-dot"></span>
          Live
        </span>
        <span v-else-if="displayWordCount > 0" class="reasoning-badge">
          {{ displayWordCount }} kata
        </span>
      </div>

      <div class="reasoning-header-right">
        <button
          v-if="thought"
          class="reasoning-copy-btn"
          type="button"
          :title="copied ? 'Tersalin!' : 'Salin proses berpikir'"
          @click="copyThought"
        >
          <Check v-if="copied" :size="13" class="text-success" />
          <Copy v-else :size="13" />
          <span class="reasoning-copy-text">{{ copied ? 'Tersalin' : 'Salin' }}</span>
        </button>

        <span class="reasoning-toggle-icon" :class="{ 'reasoning-toggle-icon--open': isExpanded }">
          <ChevronDown :size="15" />
        </span>
      </div>
    </div>

    <!-- Collapsible Body -->
    <Transition name="reasoning-collapse">
      <div v-show="isExpanded" class="reasoning-body">
        <div class="reasoning-content markdown-body" v-html="renderedThought"></div>
        <span v-if="isThinking" class="thinking-cursor" aria-hidden="true"></span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.reasoning-block {
  margin: 4px 0 12px 0;
  border-radius: 10px;
  border: 1px solid rgba(139, 92, 246, 0.22);
  background: rgba(139, 92, 246, 0.04);
  backdrop-filter: blur(8px);
  overflow: hidden;
  transition: all 0.2s ease;
}

.reasoning-block:hover {
  border-color: rgba(139, 92, 246, 0.35);
  background: rgba(139, 92, 246, 0.06);
}

.reasoning-block--active {
  border-color: rgba(168, 85, 247, 0.45);
  background: rgba(168, 85, 247, 0.08);
  box-shadow: 0 0 16px rgba(168, 85, 247, 0.12);
}

.reasoning-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  font-size: 0.82rem;
  color: var(--color-text-secondary, #9ca3af);
  transition: background 0.15s ease;
}

.reasoning-header:hover {
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-primary, #f3f4f6);
}

.reasoning-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.reasoning-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
  flex-shrink: 0;
}

.reasoning-icon-wrapper--pulse {
  background: rgba(168, 85, 247, 0.25);
  color: #c084fc;
  animation: pulseIcon 1.5s infinite ease-in-out;
}

@keyframes pulseIcon {
  0%, 100% {
    transform: scale(1);
    box-shadow: 0 0 0 rgba(168, 85, 247, 0);
  }
  50% {
    transform: scale(1.08);
    box-shadow: 0 0 8px rgba(168, 85, 247, 0.4);
  }
}

.reasoning-title {
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--color-text-primary, #e5e7eb);
  white-space: nowrap;
}

.reasoning-badge {
  font-size: 0.7rem;
  padding: 1px 7px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.07);
  color: var(--color-text-secondary, #9ca3af);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.reasoning-badge--live {
  background: rgba(168, 85, 247, 0.18);
  color: #d8b4fe;
  border-color: rgba(168, 85, 247, 0.3);
  font-weight: 600;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c084fc;
  animation: blinkDot 1s infinite ease-in-out;
}

@keyframes blinkDot {
  0%, 100% {
    opacity: 0.3;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}

.reasoning-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.reasoning-copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  font-size: 0.72rem;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--color-text-secondary, #9ca3af);
  cursor: pointer;
  transition: all 0.15s ease;
}

.reasoning-copy-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary, #f3f4f6);
}

.reasoning-copy-text {
  display: inline-block;
}

.reasoning-toggle-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary, #9ca3af);
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.reasoning-toggle-icon--open {
  transform: rotate(180deg);
}

.reasoning-body {
  border-top: 1px solid rgba(139, 92, 246, 0.12);
  padding: 10px 14px 12px 14px;
  background: rgba(0, 0, 0, 0.12);
  max-height: 420px;
  overflow-y: auto;
  position: relative;
}

.reasoning-content {
  font-size: 0.82rem;
  line-height: 1.55;
  color: var(--color-text-secondary, #cbd5e1);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  opacity: 0.92;
}

/* Specific styling for markdown inside reasoning body */
.reasoning-content :deep(p) {
  margin: 0.4em 0;
}

.reasoning-content :deep(p:first-child) {
  margin-top: 0;
}

.reasoning-content :deep(p:last-child) {
  margin-bottom: 0;
}

.reasoning-content :deep(pre) {
  background: rgba(0, 0, 0, 0.25);
  padding: 8px;
  border-radius: 6px;
  font-size: 0.78rem;
}

.thinking-cursor {
  display: inline-block;
  width: 6px;
  height: 14px;
  vertical-align: -2px;
  margin-left: 3px;
  background-color: #a78bfa;
  animation: cursorBlink 0.9s infinite step-start;
}

@keyframes cursorBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.reasoning-collapse-enter-active,
.reasoning-collapse-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.reasoning-collapse-enter-from,
.reasoning-collapse-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}
</style>
