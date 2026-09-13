<script setup>
import { MessagesSquare, Code2 } from 'lucide-vue-next'

// Two-position segmented control at the top of the sidebar: ordinary chat on
// the left, the Vibe Coding workspace on the right.
defineProps({
  mode: {
    type: String,
    default: 'conversation', // 'conversation' | 'workspace'
  },
})

const emit = defineEmits(['update:mode'])

function select(next) {
  emit('update:mode', next)
}
</script>

<template>
  <div class="mode-switcher" role="tablist" aria-label="Mode aplikasi">
    <span class="mode-switcher-thumb" :class="{ 'mode-switcher-thumb--right': mode === 'workspace' }"></span>

    <button
      class="mode-option"
      :class="{ 'mode-option--active': mode === 'conversation' }"
      role="tab"
      :aria-selected="mode === 'conversation'"
      title="Mode obrolan biasa"
      @click="select('conversation')"
    >
      <MessagesSquare :size="14" />
      <span>Conversation</span>
    </button>

    <button
      class="mode-option"
      :class="{ 'mode-option--active': mode === 'workspace' }"
      role="tab"
      :aria-selected="mode === 'workspace'"
      title="Mode Vibe Coding: file tree, editor, dan AI yang membaca kode proyek"
      @click="select('workspace')"
    >
      <Code2 :size="14" />
      <span>Workspace</span>
    </button>
  </div>
</template>

<style scoped>
.mode-switcher {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  /* Matches model-selector-wrapper's own 12px top margin below it, so the
     switcher sits with an equal 12px gap from the header above and the model
     button below - previously this was 0 on top (touching the header's
     border line) and 22px on the bottom (10 here + the selector's own 12),
     which read as stuck to the header and oddly far from the model button. */
  margin: 12px 12px 0;
  padding: 3px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg-input);
}

/* The sliding highlight behind the active half. */
.mode-switcher-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: calc(50% - 4px);
  height: calc(100% - 6px);
  border-radius: 8px;
  background: var(--color-accent-subtle);
  border: 1px solid var(--color-accent);
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
}

.mode-switcher-thumb--right {
  transform: translateX(calc(100% + 2px));
}

.mode-option {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 4px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.18s ease;
  white-space: nowrap;
}

.mode-option:hover {
  color: var(--color-text-secondary);
}

.mode-option--active {
  color: var(--color-text-accent);
}
</style>
