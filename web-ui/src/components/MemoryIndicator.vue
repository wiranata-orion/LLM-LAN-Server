<script setup>
import { computed } from 'vue'
import { BrainCircuit } from 'lucide-vue-next'

// connected: true = agent-server (and its memory store) is reachable,
// false = unreachable, null = still checking on first load.
// activity: 'idle' | 'read' | 'write' - live status of the memory subsystem
// for the current chat turn (see orchestrator.ts's MemoryEvent stream).
// ragEnabled: Settings > Parameter AI > "Enable RAG / Context Retrieval".
// When off, the agent-server skips memory/document retrieval entirely for
// every turn (see orchestrator.ts's prepareContext), so this always wins
// over the connectivity-based states below - a connected-but-unused memory
// store would otherwise still show as "Ingatan Aktif", which is misleading
// about what's actually happening to the user's messages right now.
const props = defineProps({
  connected: { type: Boolean, default: null },
  activity: { type: String, default: 'idle' },
  errorMessage: { type: String, default: '' },
  ragEnabled: { type: Boolean, default: true },
})

const statusKey = computed(() => {
  if (!props.ragEnabled) return 'disabled'
  if (props.connected === null) return 'checking'
  if (props.connected === false) return 'offline'
  if (props.activity === 'read') return 'reading'
  if (props.activity === 'write') return 'writing'
  return 'connected'
})

const label = computed(() => ({
  disabled: 'Ingatan Nonaktif',
  checking: 'Memeriksa...',
  offline: 'Terputus',
  reading: 'Membaca...',
  writing: 'Menulis...',
  connected: 'Ingatan Aktif',
}[statusKey.value]))

const title = computed(() => ({
  disabled: 'RAG / Context Retrieval dimatikan di Settings > Parameter AI - balasan tidak membaca atau menulis ingatan/dokumen untuk mempercepat respons.',
  checking: 'Memeriksa koneksi ke ingatan (agent-server)...',
  offline: `Ingatan terputus - percakapan tidak dapat membaca/menulis memori jangka panjang. ${props.errorMessage ? `(${props.errorMessage})` : 'Jalankan agent-server untuk mengaktifkannya kembali.'}`,
  reading: 'Sedang membaca ingatan: mengambil fakta & percakapan relevan sebagai konteks.',
  writing: 'Sedang menulis ke ingatan: menyimpan pesan ini ke memori jangka panjang.',
  connected: 'Percakapan ini terhubung ke ingatan. Memori jangka panjang aktif dan siap membaca/menulis.',
}[statusKey.value]))
</script>

<template>
  <div
    class="memory-status-pill"
    :class="`memory-status-pill--${statusKey}`"
    :title="title"
    role="status"
    :aria-label="title"
  >
    <span class="memory-icon-wrap">
      <BrainCircuit :size="13" />
      <span class="memory-dot" :class="`memory-dot--${statusKey}`"></span>
    </span>
    <span class="memory-label">{{ label }}</span>
  </div>
</template>

<style scoped>
.memory-status-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 20px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  font-size: 0.76rem;
  font-weight: 600;
  font-family: var(--font-sans);
  white-space: nowrap;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.memory-icon-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.memory-dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1.5px solid var(--color-bg-tertiary);
  flex-shrink: 0;
  transition: all 0.2s ease;
}

/* Checking: unresolved yet, keep it quiet */
.memory-status-pill--checking {
  color: var(--color-text-muted);
}
.memory-dot--checking {
  background: var(--color-text-muted);
}

/* Disabled: RAG turned off by the user in Settings - a deliberate, not an
   error, state, so it's muted like "checking" rather than red like "offline". */
.memory-status-pill--disabled {
  color: var(--color-text-muted);
  opacity: 0.75;
}
.memory-dot--disabled {
  background: var(--color-text-muted);
}

/* Offline: memory unreachable */
.memory-status-pill--offline {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: var(--color-danger);
}
.memory-dot--offline {
  background: var(--color-danger);
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.7);
}

/* Connected & idle: memory is live but not doing anything right now */
.memory-status-pill--connected {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.3);
  color: var(--color-success);
}
.memory-dot--connected {
  background: var(--color-success);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.7);
}

/* Reading: recalling facts/context from memory - violet/blue */
.memory-status-pill--reading {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.35);
  color: #3b82f6;
}
.memory-dot--reading {
  background: #3b82f6;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.8);
  animation: memoryPulseBlue 1.1s infinite ease-in-out;
}
.memory-status-pill--reading .memory-icon-wrap {
  animation: memoryIconBob 1.1s infinite ease-in-out;
}

/* Writing: persisting a message to memory - amber */
.memory-status-pill--writing {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.35);
  color: #f59e0b;
}
.memory-dot--writing {
  background: #f59e0b;
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.8);
  animation: memoryPulseAmber 1.1s infinite ease-in-out;
}
.memory-status-pill--writing .memory-icon-wrap {
  animation: memoryIconBob 1.1s infinite ease-in-out;
}

@keyframes memoryPulseBlue {
  0%, 100% { box-shadow: 0 0 6px rgba(59, 130, 246, 0.6); transform: scale(1); }
  50% { box-shadow: 0 0 12px rgba(59, 130, 246, 1); transform: scale(1.25); }
}

@keyframes memoryPulseAmber {
  0%, 100% { box-shadow: 0 0 6px rgba(245, 158, 11, 0.6); transform: scale(1); }
  50% { box-shadow: 0 0 12px rgba(245, 158, 11, 1); transform: scale(1.25); }
}

@keyframes memoryIconBob {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

@media (max-width: 520px) {
  .memory-label {
    display: none;
  }
  .memory-status-pill {
    padding: 5px 8px;
  }
}
</style>
