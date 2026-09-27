<script setup>
import { ref, computed, watch } from 'vue'
import { Play, Loader2, CheckCircle2, XCircle, TimerOff, Terminal } from 'lucide-vue-next'
import { runJavaScript, runPython } from '../services/codeExecutionEngine.js'
import { runShellScript } from '../services/shellSimulator.js'
import { getSettings } from '../services/api.js'

const props = defineProps({
  source: {
    type: String,
    required: true,
  },
  // Normalized runner kind - see WorkspaceCodeBlock.vue's runnableKind computed.
  runner: {
    type: String,
    required: true, // 'javascript' | 'typescript' | 'python' | 'shell'
  },
})

const isRunning = ref(false)
const result = ref(null) // ExecutionResult | null

async function run() {
  if (isRunning.value) return
  isRunning.value = true
  result.value = null
  const timeoutMs = getSettings().codeExecutionTimeoutMs || 5000

  try {
    if (props.runner === 'python') {
      result.value = await runPython(props.source, { timeoutMs })
    } else if (props.runner === 'shell') {
      result.value = runShellScript(props.source)
    } else {
      result.value = await runJavaScript(props.source, { timeoutMs, language: props.runner })
    }
  } finally {
    isRunning.value = false
  }
}

// Settings > Sandbox & Execution > "Auto-Run Skrip Aman" - every runner here
// is already sandboxed (Worker + timeout for JS/Python, a disposable
// in-memory DB/FS for SQL/shell), so "safe" just means "doesn't need a
// manual click", not a narrower allow-list of languages.
if (getSettings().codeExecutionMode === 'auto') run()

const statusLabel = computed(() => {
  if (isRunning.value) return 'Menjalankan...'
  if (!result.value) return null
  if (result.value.timedOut) return 'Timeout'
  return result.value.ok ? 'Selesai' : 'Error'
})

watch(() => props.source, () => {
  result.value = null
})
</script>

<template>
  <div class="runner-widget">
    <div class="runner-toolbar">
      <button class="runner-run-btn" type="button" :disabled="isRunning" @click="run">
        <Loader2 v-if="isRunning" :size="13" class="spin" />
        <Play v-else :size="13" />
        <span>{{ isRunning ? 'Menjalankan...' : 'Run' }}</span>
      </button>
      <span v-if="statusLabel" class="runner-status" :class="{
        'runner-status--ok': result?.ok && !result?.timedOut,
        'runner-status--error': result && !result.ok && !result.timedOut,
        'runner-status--timeout': result?.timedOut,
      }">
        <CheckCircle2 v-if="result?.ok && !result?.timedOut" :size="12" />
        <TimerOff v-else-if="result?.timedOut" :size="12" />
        <XCircle v-else-if="result && !result.ok" :size="12" />
        <span>{{ statusLabel }}</span>
        <span v-if="result" class="runner-duration">({{ Math.round(result.durationMs) }}ms)</span>
      </span>
    </div>

    <div v-if="result" class="runner-console">
      <div v-if="!result.logs.length && result.ok && !result.returnValue" class="runner-console-empty">
        <Terminal :size="12" />
        <span>Tidak ada output.</span>
      </div>
      <div v-for="(log, index) in result.logs" :key="index" class="runner-console-line" :class="`runner-console-line--${log.level}`">
        {{ log.message }}
      </div>
      <div v-if="result.returnValue !== undefined" class="runner-console-line runner-console-line--return">
        ⤷ {{ result.returnValue }}
      </div>
      <div v-if="!result.ok" class="runner-console-line runner-console-line--error">
        {{ result.error }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.runner-widget {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  overflow: hidden;
}

.runner-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
}

.runner-run-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: var(--color-accent);
  color: var(--color-on-accent, white);
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
}

.runner-run-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.runner-status {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.runner-status--ok {
  color: #22c55e;
}

.runner-status--error {
  color: var(--color-danger, #ef4444);
}

.runner-status--timeout {
  color: #f59e0b;
}

.runner-duration {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.runner-console {
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: 0.76rem;
  line-height: 1.5;
  max-height: 240px;
  overflow-y: auto;
}

.runner-console-empty {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--color-text-muted);
}

.runner-console-line {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-text-secondary);
}

.runner-console-line--warn {
  color: #f59e0b;
}

.runner-console-line--error {
  color: var(--color-danger, #ef4444);
}

.runner-console-line--return {
  color: var(--color-text-accent);
  border-top: 1px dashed var(--color-border);
  margin-top: 4px;
  padding-top: 4px;
}
</style>
