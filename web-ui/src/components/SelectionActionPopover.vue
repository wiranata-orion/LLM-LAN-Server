<script setup>
import { Lightbulb, Bug, Wand2, Gauge } from 'lucide-vue-next'

defineProps({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
})

// 'action' carries one of these ids - ChatView.vue turns it into a prompt
// referencing the selected text and sends it through the normal pipeline.
const emit = defineEmits(['action'])

const ACTIONS = [
  { id: 'explain', label: 'Explain', icon: Lightbulb },
  { id: 'find-bugs', label: 'Find Bugs', icon: Bug },
  { id: 'refactor', label: 'Refactor', icon: Wand2 },
  { id: 'optimize', label: 'Optimize', icon: Gauge },
]
</script>

<template>
  <div class="selection-popover glass" :style="{ left: `${x}px`, top: `${y}px` }" @mousedown.prevent>
    <button
      v-for="action in ACTIONS"
      :key="action.id"
      class="selection-popover-btn"
      type="button"
      @click="emit('action', action.id)"
    >
      <component :is="action.icon" :size="12" />
      <span>{{ action.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.selection-popover {
  position: fixed;
  transform: translate(-50%, calc(-100% - 8px));
  display: flex;
  gap: 2px;
  padding: 4px;
  border-radius: 10px;
  z-index: 150;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  white-space: nowrap;
}

.selection-popover-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border: none;
  border-radius: 7px;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all 0.15s ease;
}

.selection-popover-btn:hover {
  background: var(--color-accent-subtle);
  color: var(--color-text-accent);
}
</style>
