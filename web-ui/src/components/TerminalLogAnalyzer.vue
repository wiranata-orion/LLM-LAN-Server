<script setup>
import { ref, computed } from 'vue'
import { X, Terminal, AlertTriangle, Sparkles, RotateCcw } from 'lucide-vue-next'
import { cleanTerminalLog, detectErrorSignature } from '../services/terminalLogParser.js'

// 'send-to-ai' carries the fully composed prompt - App.vue's handler sends
// it through the normal chat pipeline and closes this.
const emit = defineEmits(['close', 'send-to-ai'])

const rawLog = ref('')
const analyzed = ref(null) // { text, truncated, originalLineCount, signature } | null

function analyze() {
  if (!rawLog.value.trim()) return
  const cleaned = cleanTerminalLog(rawLog.value)
  analyzed.value = { ...cleaned, signature: detectErrorSignature(rawLog.value) }
}

function reset() {
  rawLog.value = ''
  analyzed.value = null
}

const promptPreview = computed(() => (
  analyzed.value
    ? `Berikut log error dari terminal. Tolong analisis root cause-nya dan berikan langkah perbaikan step-by-step:\n\n\`\`\`\n${analyzed.value.text}\n\`\`\``
    : ''
))

function sendToAi() {
  if (!analyzed.value) return
  emit('send-to-ai', promptPreview.value)
}
</script>

<template>
  <Transition name="modal-backdrop">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div class="terminal-modal glass">
        <div class="terminal-header">
          <div class="terminal-title">
            <Terminal :size="16" />
            <span>Analisis Log Error</span>
          </div>
          <button class="terminal-close-btn" @click="emit('close')" title="Tutup">
            <X :size="16" />
          </button>
        </div>

        <div class="terminal-body">
          <template v-if="!analyzed">
            <p class="terminal-hint">Tempel log error mentah (Laravel stack trace, exception Node.js, log build Docker, dll) di bawah ini.</p>
            <textarea
              v-model="rawLog"
              class="terminal-textarea"
              rows="12"
              placeholder="Tempel log di sini..."
              spellcheck="false"
            ></textarea>
            <div class="terminal-actions">
              <button class="terminal-action-btn terminal-action-btn--primary" type="button" :disabled="!rawLog.trim()" @click="analyze">
                Analisis
              </button>
            </div>
          </template>

          <template v-else>
            <div v-if="analyzed.signature" class="terminal-signature">
              <AlertTriangle :size="14" />
              <span>{{ analyzed.signature }}</span>
            </div>
            <p class="terminal-meta">
              {{ analyzed.originalLineCount }} baris asli{{ analyzed.truncated ? ' (dipangkas ke bagian awal + akhir untuk AI)' : '' }}.
            </p>
            <pre class="terminal-preview">{{ analyzed.text }}</pre>
            <div class="terminal-actions">
              <button class="terminal-action-btn" type="button" @click="reset">
                <RotateCcw :size="13" /><span>Log Lain</span>
              </button>
              <button class="terminal-action-btn terminal-action-btn--primary" type="button" @click="sendToAi">
                <Sparkles :size="13" /><span>Kirim ke AI untuk Analisis</span>
              </button>
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

.terminal-modal {
  width: 620px;
  max-width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-light, var(--color-border));
}

.terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.terminal-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-primary);
  font-weight: 600;
  font-size: 0.92rem;
}

.terminal-close-btn {
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

.terminal-close-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.terminal-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
}

.terminal-hint {
  margin: 0 0 10px;
  font-size: 0.82rem;
  color: var(--color-text-secondary);
}

.terminal-textarea {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  padding: 10px 12px;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.terminal-textarea:focus {
  border-color: var(--color-accent);
}

.terminal-signature {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.35);
  color: var(--color-danger, #ef4444);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  margin-bottom: 10px;
  word-break: break-word;
}

.terminal-meta {
  margin: 0 0 8px;
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.terminal-preview {
  margin: 0 0 14px;
  padding: 12px;
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 0.74rem;
  line-height: 1.5;
  white-space: pre-wrap;
  max-height: 320px;
  overflow-y: auto;
}

.terminal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.terminal-action-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
}

.terminal-action-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-text-primary);
}

.terminal-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.terminal-action-btn--primary {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-on-accent, white);
}
</style>
