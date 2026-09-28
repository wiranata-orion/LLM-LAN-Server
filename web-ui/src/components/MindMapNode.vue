<script setup>
import { ref, computed } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
// Explicit self-import for recursion, rather than relying on <script setup>'s
// filename-based auto-inference (works, but is documented as a minifier
// footgun) - see https://vuejs.org/guide/components/registration.html#recursive-components.
// eslint-disable-next-line no-self-import
import MindMapNode from './MindMapNode.vue'

const props = defineProps({
  node: {
    type: Object,
    required: true,
    // { label: string, children: MindMapNode[] } - see mindMapParser.js
  },
  // Root and its immediate children start expanded so the map isn't a
  // single collapsed dot on first render; anything deeper starts collapsed
  // so a large map doesn't dump its entire structure onto the screen at once.
  depth: {
    type: Number,
    default: 0,
  },
})

const isExpanded = ref(props.depth < 2)
const hasChildren = computed(() => props.node.children.length > 0)
</script>

<template>
  <div class="mindmap-node">
    <button
      class="mindmap-node-row"
      type="button"
      :class="{ 'mindmap-node-row--leaf': !hasChildren }"
      @click="hasChildren && (isExpanded = !isExpanded)"
    >
      <ChevronRight v-if="hasChildren" :size="12" class="mindmap-chevron" :class="{ 'mindmap-chevron--open': isExpanded }" />
      <span v-else class="mindmap-leaf-dot"></span>
      <span class="mindmap-label">{{ node.label }}</span>
    </button>

    <div v-if="hasChildren && isExpanded" class="mindmap-children">
      <MindMapNode v-for="(child, index) in node.children" :key="index" :node="child" :depth="depth + 1" />
    </div>
  </div>
</template>

<style scoped>
.mindmap-node {
  position: relative;
}

.mindmap-node-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: none;
  background: none;
  color: var(--color-text-primary);
  font-size: 0.82rem;
  font-family: var(--font-sans);
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  width: 100%;
}

.mindmap-node-row:hover {
  background: var(--color-bg-hover);
}

.mindmap-node-row--leaf {
  cursor: default;
  color: var(--color-text-secondary);
}

.mindmap-node-row--leaf:hover {
  background: none;
}

.mindmap-chevron {
  flex-shrink: 0;
  color: var(--color-text-muted);
  transition: transform 0.15s ease;
}

.mindmap-chevron--open {
  transform: rotate(90deg);
}

.mindmap-leaf-dot {
  flex-shrink: 0;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-text-muted);
  margin: 0 3.5px;
}

.mindmap-label {
  overflow-wrap: anywhere;
}

.mindmap-children {
  margin-left: 16px;
  padding-left: 10px;
  border-left: 1px solid var(--color-border);
}
</style>
