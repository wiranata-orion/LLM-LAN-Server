<script setup>
import { Network } from 'lucide-vue-next'
import MindMapNode from './MindMapNode.vue'

defineProps({
  // A validated { root: MindMapNode } - see mindMapParser.js.
  schema: {
    type: Object,
    required: true,
  },
})
</script>

<template>
  <div class="mindmap-widget">
    <div class="mindmap-header">
      <Network :size="14" />
      <span>Peta Pikiran</span>
    </div>
    <MindMapNode :node="schema.root" :depth="0" />
  </div>
</template>

<style scoped>
.mindmap-widget {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg-secondary);
  padding: 12px 10px 14px;
  margin: 8px 0;
}

.mindmap-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 8px;
  color: var(--color-text-accent);
  font-size: 0.78rem;
  font-weight: 600;
}
</style>
