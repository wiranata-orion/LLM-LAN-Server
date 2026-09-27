<script setup>
import { ref, computed } from 'vue'
import { X, Pin, Trash2, Copy, Check } from 'lucide-vue-next'
import { getPinnedNotes, unpinNote } from '../services/pinnedNotes.js'
// Same renderer the chat bubble itself uses (see MessageBubble.vue) - a
// pinned note is a verbatim copy of a reply's content, so it must render
// identically (code blocks, tables, math, ...) instead of showing raw
// markdown syntax as plain text.
import { renderMarkdown } from '../services/markdownRenderer.js'

const emit = defineEmits(['close', 'jump-to-conversation'])

// A plain array snapshot, not reactive to outside pin/unpin calls made while
// this drawer is closed - refreshed on every open (see App.vue's v-if) via
// this same onMounted-less approach: reading it directly at module-eval time
// here is enough since the component is destroyed/recreated each time it's
// toggled (v-if, not v-show).
const notes = ref(getPinnedNotes())

function handleUnpin(id) {
  unpinNote(id)
  notes.value = notes.value.filter((note) => note.id !== id)
}

const copiedId = ref(null)
async function copyNote(note) {
  try {
    await navigator.clipboard.writeText(note.content)
    copiedId.value = note.id
    setTimeout(() => {
      if (copiedId.value === note.id) copiedId.value = null
    }, 1500)
  } catch {
    // Clipboard permission denied or unavailable - the note stays visible on
    // screen either way, so there's nothing else useful to fall back to.
  }
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

const groupedByConversation = computed(() => {
  const groups = new Map()
  for (const note of notes.value) {
    if (!groups.has(note.conversationId)) groups.set(note.conversationId, { title: note.conversationTitle, notes: [] })
    groups.get(note.conversationId).notes.push(note)
  }
  return [...groups.entries()].map(([conversationId, group]) => ({ conversationId, ...group }))
})
</script>

<template>
  <Transition name="modal-backdrop">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div class="pinned-drawer glass">
        <div class="pinned-drawer-header">
          <div class="pinned-drawer-title">
            <Pin :size="16" />
            <span>Key Notes ({{ notes.length }})</span>
          </div>
          <button class="pinned-drawer-close" @click="emit('close')" title="Tutup">
            <X :size="16" />
          </button>
        </div>

        <div class="pinned-drawer-body">
          <div v-if="!notes.length" class="pinned-drawer-empty">
            <Pin :size="28" />
            <p>Belum ada catatan yang disematkan.</p>
            <p class="pinned-drawer-empty-hint">Klik ikon pin pada balasan AI untuk menyimpannya di sini.</p>
          </div>

          <div v-for="group in groupedByConversation" :key="group.conversationId" class="pinned-group">
            <button class="pinned-group-title" type="button" @click="emit('jump-to-conversation', group.conversationId)">
              {{ group.title }}
            </button>
            <div v-for="note in group.notes" :key="note.id" class="pinned-note-card">
              <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown() is the same markdown-it pipeline MessageBubble.vue uses, with html:false -->
              <div class="pinned-note-content markdown-body" v-html="renderMarkdown(note.content)"></div>
              <div class="pinned-note-footer">
                <span class="pinned-note-date">{{ formatDate(note.pinnedAt) }}</span>
                <div class="pinned-note-actions">
                  <button class="pinned-note-action-btn" type="button" title="Salin" @click="copyNote(note)">
                    <Check v-if="copiedId === note.id" :size="12" />
                    <Copy v-else :size="12" />
                  </button>
                  <button class="pinned-note-action-btn pinned-note-action-btn--danger" type="button" title="Lepas pin" @click="handleUnpin(note.id)">
                    <Trash2 :size="12" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  justify-content: flex-end;
  z-index: 200;
}

.pinned-drawer {
  width: 380px;
  max-width: 90vw;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--color-border-light, var(--color-border));
  background: var(--color-bg-secondary);
}

.pinned-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.pinned-drawer-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-primary);
  font-weight: 600;
  font-size: 0.92rem;
}

.pinned-drawer-close {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
}

.pinned-drawer-close:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.pinned-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 18px;
}

.pinned-drawer-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 60px 20px;
  color: var(--color-text-muted);
  text-align: center;
}

.pinned-drawer-empty-hint {
  font-size: 0.78rem;
  margin: 0;
}

.pinned-group {
  margin-bottom: 18px;
}

.pinned-group-title {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 0 0 8px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-accent);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
}

.pinned-group-title:hover {
  text-decoration: underline;
}

.pinned-note-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  padding: 10px 12px;
  margin-bottom: 8px;
}

/* .markdown-body (global, defined in MessageBubble.vue) supplies the actual
   content styling - headings, code blocks, tables, lists, math - so this
   only adds the container behavior specific to a compact drawer card. */
.pinned-note-content {
  margin: 0 0 8px;
  font-size: 0.82rem;
  overflow-wrap: anywhere;
  max-height: 220px;
  overflow-y: auto;
}

.pinned-note-content :deep(p) {
  margin: 0.4em 0;
}

.pinned-note-content :deep(p:first-child) {
  margin-top: 0;
}

.pinned-note-content :deep(p:last-child) {
  margin-bottom: 0;
}

.pinned-note-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pinned-note-date {
  font-size: 0.68rem;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.pinned-note-actions {
  display: flex;
  gap: 4px;
}

.pinned-note-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
}

.pinned-note-action-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.pinned-note-action-btn--danger:hover {
  color: var(--color-danger);
  background: rgba(239, 68, 68, 0.12);
}
</style>
