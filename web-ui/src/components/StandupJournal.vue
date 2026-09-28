<script setup>
import { ref, computed } from 'vue'
import { X, ClipboardList, ChevronLeft, ChevronRight, Copy, Check, Download, Send, Trash2, Sparkles } from 'lucide-vue-next'
import { getJournalEntries, addJournalEntry, deleteJournalEntry, compileMarkdown } from '../services/journalEntries.js'

// 'send-to-ai' carries the compiled markdown - App.vue's handler sends it as
// the next chat message (reusing the normal send pipeline) and closes this.
const emit = defineEmits(['close', 'send-to-ai'])

const STEPS = [
  { key: 'completed', question: 'Apa yang sudah kamu kerjakan hari ini?' },
  { key: 'blockers', question: 'Ada blocker atau kendala?' },
  { key: 'nextSteps', question: 'Apa rencana selanjutnya?' },
]

const mode = ref('compose') // 'compose' | 'history'
const stepIndex = ref(0)
const answers = ref({ completed: '', blockers: '', nextSteps: '' })
const isDone = computed(() => stepIndex.value >= STEPS.length)
const currentStep = computed(() => STEPS[stepIndex.value])

function goNext() {
  if (stepIndex.value < STEPS.length) stepIndex.value += 1
}

function goPrev() {
  if (stepIndex.value > 0) stepIndex.value -= 1
}

const compiledMarkdown = computed(() => compileMarkdown(answers.value))

function startOver() {
  stepIndex.value = 0
  answers.value = { completed: '', blockers: '', nextSteps: '' }
}

function saveEntry() {
  addJournalEntry({ ...answers.value })
  entries.value = getJournalEntries()
  startOver()
  mode.value = 'history'
}

function sendToAi() {
  addJournalEntry({ ...answers.value })
  emit('send-to-ai', compiledMarkdown.value)
}

const copied = ref(false)
async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(compiledMarkdown.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch {
    // Clipboard permission denied - the compiled text is still visible on screen.
  }
}

function downloadMarkdown() {
  const blob = new Blob([compiledMarkdown.value], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `standup-${new Date().toISOString().slice(0, 10)}.md`
  link.click()
  URL.revokeObjectURL(url)
}

// ---- History ----
const entries = ref(getJournalEntries())

function removeEntry(id) {
  deleteJournalEntry(id)
  entries.value = entries.value.filter((entry) => entry.id !== id)
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
</script>

<template>
  <Transition name="modal-backdrop">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div class="standup-modal glass">
        <div class="standup-header">
          <div class="standup-title">
            <ClipboardList :size="16" />
            <span>Standup / Journal</span>
          </div>
          <div class="standup-mode-toggle">
            <button class="standup-mode-btn" :class="{ 'standup-mode-btn--active': mode === 'compose' }" type="button" @click="mode = 'compose'">Isi Baru</button>
            <button class="standup-mode-btn" :class="{ 'standup-mode-btn--active': mode === 'history' }" type="button" @click="mode = 'history'">Riwayat ({{ entries.length }})</button>
          </div>
          <button class="standup-close-btn" @click="emit('close')" title="Tutup">
            <X :size="16" />
          </button>
        </div>

        <div class="standup-body">
          <!-- ===== Compose: step-by-step guided reflection ===== -->
          <template v-if="mode === 'compose'">
            <template v-if="!isDone">
              <div class="standup-progress">Langkah {{ stepIndex + 1 }}/{{ STEPS.length }}</div>
              <p class="standup-question">{{ currentStep.question }}</p>
              <textarea
                v-model="answers[currentStep.key]"
                class="standup-textarea"
                rows="5"
                :placeholder="currentStep.key === 'blockers' ? 'Kosongkan jika tidak ada blocker...' : 'Tulis jawabanmu...'"
              ></textarea>
              <div class="standup-nav">
                <button class="standup-nav-btn" type="button" :disabled="stepIndex === 0" @click="goPrev">
                  <ChevronLeft :size="14" /><span>Sebelumnya</span>
                </button>
                <button class="standup-nav-btn standup-nav-btn--primary" type="button" @click="goNext">
                  <span>{{ stepIndex === STEPS.length - 1 ? 'Selesai' : 'Selanjutnya' }}</span><ChevronRight :size="14" />
                </button>
              </div>
            </template>

            <!-- ===== Compiled preview ===== -->
            <template v-else>
              <pre class="standup-preview">{{ compiledMarkdown }}</pre>
              <div class="standup-actions">
                <button class="standup-action-btn" type="button" @click="goPrev">
                  <ChevronLeft :size="13" /><span>Edit</span>
                </button>
                <button class="standup-action-btn" type="button" @click="copyMarkdown">
                  <Check v-if="copied" :size="13" /><Copy v-else :size="13" /><span>{{ copied ? 'Disalin' : 'Salin' }}</span>
                </button>
                <button class="standup-action-btn" type="button" @click="downloadMarkdown">
                  <Download :size="13" /><span>Unduh .md</span>
                </button>
                <button class="standup-action-btn" type="button" @click="saveEntry">
                  <ClipboardList :size="13" /><span>Simpan</span>
                </button>
                <button class="standup-action-btn standup-action-btn--primary" type="button" @click="sendToAi">
                  <Send :size="13" /><span>Kirim ke AI</span>
                </button>
              </div>
            </template>
          </template>

          <!-- ===== History ===== -->
          <template v-else>
            <div v-if="!entries.length" class="standup-empty">
              <ClipboardList :size="26" />
              <p>Belum ada entri standup.</p>
            </div>
            <div v-for="entry in entries" :key="entry.id" class="standup-entry-card">
              <div class="standup-entry-header">
                <span class="standup-entry-date">{{ formatDate(entry.createdAt) }}</span>
                <div class="standup-entry-actions">
                  <button class="standup-entry-action-btn" type="button" title="Kirim ke AI" @click="emit('send-to-ai', entry.markdown)">
                    <Sparkles :size="12" />
                  </button>
                  <button class="standup-entry-action-btn standup-entry-action-btn--danger" type="button" title="Hapus" @click="removeEntry(entry.id)">
                    <Trash2 :size="12" />
                  </button>
                </div>
              </div>
              <pre class="standup-entry-preview">{{ entry.markdown }}</pre>
            </div>
          </template>
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
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 20px;
}

.standup-modal {
  width: 520px;
  max-width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-light, var(--color-border));
}

.standup-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.standup-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-primary);
  font-weight: 600;
  font-size: 0.92rem;
}

.standup-mode-toggle {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--color-bg-tertiary);
  margin-left: auto;
}

.standup-mode-btn {
  padding: 5px 10px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--color-text-muted);
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
}

.standup-mode-btn--active {
  background: var(--color-accent-subtle);
  color: var(--color-text-accent);
}

.standup-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.standup-close-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.standup-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
}

.standup-progress {
  font-size: 0.72rem;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  margin-bottom: 8px;
}

.standup-question {
  margin: 0 0 12px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.standup-textarea {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: 0.85rem;
  padding: 10px 12px;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.standup-textarea:focus {
  border-color: var(--color-accent);
}

.standup-nav {
  display: flex;
  justify-content: space-between;
  margin-top: 14px;
}

.standup-nav-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 7px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
}

.standup-nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.standup-nav-btn--primary {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-on-accent, white);
}

.standup-preview {
  margin: 0 0 14px;
  padding: 14px;
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  line-height: 1.6;
  white-space: pre-wrap;
  max-height: 320px;
  overflow-y: auto;
}

.standup-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.standup-action-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.78rem;
  cursor: pointer;
}

.standup-action-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-text-primary);
}

.standup-action-btn--primary {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-on-accent, white);
}

.standup-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 50px 20px;
  color: var(--color-text-muted);
  text-align: center;
}

.standup-entry-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  padding: 10px 12px;
  margin-bottom: 10px;
}

.standup-entry-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.standup-entry-date {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.standup-entry-actions {
  display: flex;
  gap: 4px;
}

.standup-entry-action-btn {
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

.standup-entry-action-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.standup-entry-action-btn--danger:hover {
  color: var(--color-danger);
  background: rgba(239, 68, 68, 0.12);
}

.standup-entry-preview {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  max-height: 120px;
  overflow-y: auto;
}
</style>
