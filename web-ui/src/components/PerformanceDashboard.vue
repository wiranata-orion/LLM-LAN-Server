<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { X, RefreshCw, Cpu, Server, Laptop, Gauge, HardDrive, Clock, AlertCircle } from 'lucide-vue-next'
import { getSettings, checkEnginePing } from '../services/api.js'
import { getPerformanceHistory, getRunningModels, checkAgentHealth } from '../services/api.ts'

const emit = defineEmits(['close'])

function closeModal() {
  emit('close')
}

function handleKeyDown(e) {
  if (e.key === 'Escape') closeModal()
}

function normalizeUrl(url) {
  return (url || '').trim().replace(/\/+$/, '')
}

/** Both PC Server and Laptop history/live-status rows carry a raw ollamaBaseUrl - this turns it back into the human label the rest of the app uses. */
function labelForEngine(ollamaBaseUrl) {
  const normalized = normalizeUrl(ollamaBaseUrl)
  if (!normalized) return '-'
  if (normalized === normalizeUrl(settings.pcUrl)) return 'PC Server'
  if (normalized === normalizeUrl(settings.laptopUrl)) return 'Laptop'
  return ollamaBaseUrl
}

// ===== Engine selection =====
// This dashboard's whole point is checking on an engine's state - which
// often means the one you're NOT currently chatting on (e.g. "did the PC
// Server's VRAM actually clear while I've been on Laptop?"). It defaults to
// whichever is globally active but is independently switchable here, and
// never touches the app's actual active-engine setting.
const settings = getSettings()
const selectedEngine = ref(settings.activeEngine === 'pc' ? 'pc' : 'laptop')
const selectedEngineLabel = computed(() => (selectedEngine.value === 'pc' ? 'PC Server' : 'Laptop'))
const selectedEngineUrl = computed(() => (selectedEngine.value === 'pc' ? settings.pcUrl : settings.laptopUrl))

function selectEngine(engine) {
  if (selectedEngine.value === engine) return
  selectedEngine.value = engine
  loadServerStatus()
  loadRunningModels()
}

// ===== Server info =====
const agentOk = ref(null) // null = checking, true/false after first check
const ollamaVersion = ref('')
const ollamaPingMs = ref(null)
const ollamaError = ref('')

async function loadAgentStatus() {
  try {
    const result = await checkAgentHealth()
    agentOk.value = result.ok
  } catch {
    agentOk.value = false
  }
}

async function loadServerStatus() {
  ollamaVersion.value = ''
  ollamaPingMs.value = null
  ollamaError.value = ''
  const url = selectedEngineUrl.value
  if (!url || !url.trim()) {
    ollamaError.value = 'Alamat engine belum diatur'
    return
  }
  const result = await checkEnginePing(url)
  if (result.online) {
    ollamaVersion.value = result.version || ''
    ollamaPingMs.value = result.ms ?? null
  } else {
    ollamaError.value = result.error || 'Tidak terjangkau'
  }
}

// ===== Running models (live, polled while open) =====
const runningModels = ref([])
const runningModelsError = ref('')
const isLoadingRunningModels = ref(false)
let runningModelsTimer = null

function formatBytes(bytes) {
  if (!bytes) return '0 MB'
  const gb = bytes / (1024 ** 3)
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`
}

function formatExpiresIn(expiresAt) {
  if (!expiresAt) return '-'
  const diffMs = new Date(expiresAt).getTime() - Date.now()
  if (Number.isNaN(diffMs)) return '-'
  if (diffMs <= 0) return 'Akan unload sebentar lagi'
  const hours = diffMs / (1000 * 60 * 60)
  if (hours > 24) return 'Ditahan (keep_alive lama/permanen)'
  const minutes = Math.floor(diffMs / 60000)
  const seconds = Math.floor((diffMs % 60000) / 1000)
  if (minutes <= 0) return `${seconds}s lagi`
  return `${minutes}m ${seconds}s lagi`
}

async function loadRunningModels() {
  isLoadingRunningModels.value = true
  try {
    const result = await getRunningModels(selectedEngineUrl.value)
    if (result.ok) {
      runningModels.value = result.models
      runningModelsError.value = ''
    } else {
      runningModels.value = []
      runningModelsError.value = result.error || 'Tidak dapat menghubungi engine'
    }
  } catch (err) {
    runningModels.value = []
    runningModelsError.value = err instanceof Error ? err.message : 'Tidak dapat menghubungi engine'
  } finally {
    isLoadingRunningModels.value = false
  }
}

// ===== Performance history + chart =====
const history = ref([])
const isLoadingHistory = ref(false)
const historyError = ref('')

async function loadHistory() {
  isLoadingHistory.value = true
  try {
    const result = await getPerformanceHistory(50)
    history.value = result.history || []
    historyError.value = ''
  } catch (err) {
    history.value = []
    historyError.value = err instanceof Error ? err.message : 'Gagal memuat riwayat performa'
  } finally {
    isLoadingHistory.value = false
  }
}

// Newest-first from the API -> chronological (oldest-first, left-to-right) for the chart,
// keeping only turns that actually completed generation (have real token counts).
const chartEntries = computed(() => {
  return [...history.value]
    .reverse()
    .filter((h) => h.evalCount && h.evalDuration)
    .map((h) => ({
      id: h.id,
      timestamp: h.timestamp,
      model: h.model,
      ollamaBaseUrl: h.ollamaBaseUrl,
      tokPerSec: h.evalCount / (h.evalDuration / 1e9),
    }))
})

const CHART_WIDTH = 640
const CHART_HEIGHT = 160
const CHART_PAD_LEFT = 34
const CHART_PAD_RIGHT = 12
const CHART_PAD_TOP = 12
const CHART_PAD_BOTTOM = 22

const chartScale = computed(() => {
  const values = chartEntries.value.map((e) => e.tokPerSec)
  const max = values.length ? Math.max(...values) : 1
  // A little headroom above the tallest point so it isn't flush against the top edge.
  return { max: max * 1.15 || 1 }
})

function chartX(index) {
  const innerWidth = CHART_WIDTH - CHART_PAD_LEFT - CHART_PAD_RIGHT
  const count = chartEntries.value.length
  if (count <= 1) return CHART_PAD_LEFT + innerWidth / 2
  return CHART_PAD_LEFT + (innerWidth * index) / (count - 1)
}

function chartY(value) {
  const innerHeight = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM
  const ratio = chartScale.value.max > 0 ? value / chartScale.value.max : 0
  return CHART_PAD_TOP + innerHeight * (1 - ratio)
}

const chartPoints = computed(() => chartEntries.value.map((entry, index) => ({
  ...entry,
  x: chartX(index),
  y: chartY(entry.tokPerSec),
})))

const chartLinePath = computed(() => {
  if (!chartPoints.value.length) return ''
  return chartPoints.value.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
})

const chartAreaPath = computed(() => {
  if (!chartPoints.value.length) return ''
  const baseline = CHART_HEIGHT - CHART_PAD_BOTTOM
  const first = chartPoints.value[0]
  const last = chartPoints.value[chartPoints.value.length - 1]
  return `${chartLinePath.value} L ${last.x.toFixed(1)} ${baseline} L ${first.x.toFixed(1)} ${baseline} Z`
})

const yAxisTicks = computed(() => {
  const max = chartScale.value.max
  return [0, 0.5, 1].map((fraction) => ({
    value: max * fraction,
    y: chartY(max * fraction),
  }))
})

const hoveredIndex = ref(null)
const hoveredPoint = computed(() => (hoveredIndex.value !== null ? chartPoints.value[hoveredIndex.value] : null))

function handleChartMouseMove(event) {
  if (!chartPoints.value.length) return
  const rect = event.currentTarget.getBoundingClientRect()
  const scaleX = CHART_WIDTH / rect.width
  const cursorX = (event.clientX - rect.left) * scaleX
  let closest = 0
  let closestDist = Infinity
  chartPoints.value.forEach((p, i) => {
    const dist = Math.abs(p.x - cursorX)
    if (dist < closestDist) {
      closestDist = dist
      closest = i
    }
  })
  hoveredIndex.value = closest
}

function handleChartMouseLeave() {
  hoveredIndex.value = null
}

function formatTimestamp(iso) {
  try {
    return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

// Split by engine rather than one blended average - PC Server and Laptop
// have very different hardware, so averaging them together would produce a
// number that describes neither one accurately.
const perEngineAverages = computed(() => {
  const groups = new Map()
  for (const entry of chartEntries.value) {
    const label = labelForEngine(entry.ollamaBaseUrl)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(entry.tokPerSec)
  }
  return [...groups.entries()].map(([label, values]) => ({
    label,
    avg: values.reduce((sum, v) => sum + v, 0) / values.length,
  }))
})

async function refreshAll() {
  await Promise.all([loadAgentStatus(), loadServerStatus(), loadRunningModels(), loadHistory()])
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  refreshAll()
  // Live-ish view of VRAM while the dashboard is open - closing it stops the
  // polling, since nobody's looking at a background timer eating CPU/network.
  runningModelsTimer = setInterval(loadRunningModels, 5000)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  if (runningModelsTimer) clearInterval(runningModelsTimer)
})
</script>

<template>
  <Transition name="modal-backdrop">
    <div class="modal-backdrop" @click.self="closeModal">
      <div class="performance-modal glass">
        <div class="modal-header">
          <div class="modal-header-info">
            <h2 class="modal-title">
              <Gauge :size="18" />
              Performance Dashboard
            </h2>
          </div>
          <div class="header-actions">
            <button class="icon-btn" @click="refreshAll" title="Refresh semua data">
              <RefreshCw :size="15" />
            </button>
            <button class="close-btn" @click="closeModal" title="Tutup">
              <X :size="18" />
            </button>
          </div>
        </div>

        <div class="modal-body">
          <!-- Engine selector - independent from the app's active chat engine,
               so you can check on "the other" engine without switching to it. -->
          <div class="engine-select-row">
            <span class="engine-select-label">Periksa engine:</span>
            <div class="engine-select-tabs">
              <button
                class="engine-select-tab"
                :class="{ 'engine-select-tab--active': selectedEngine === 'pc' }"
                @click="selectEngine('pc')"
              >
                <Server :size="13" />
                <span>PC Server</span>
              </button>
              <button
                class="engine-select-tab"
                :class="{ 'engine-select-tab--active': selectedEngine === 'laptop' }"
                @click="selectEngine('laptop')"
              >
                <Laptop :size="13" />
                <span>Laptop</span>
              </button>
            </div>
          </div>

          <!-- Server Info -->
          <section class="perf-section">
            <span class="perf-section-title">Info Server</span>
            <div class="server-info-grid">
              <div class="info-card glass">
                <div class="info-card-label">
                  <Server v-if="selectedEngine === 'pc'" :size="14" />
                  <Laptop v-else :size="14" />
                  <span>Engine Dipilih</span>
                </div>
                <span class="info-card-value">{{ selectedEngineLabel }}</span>
                <span class="info-card-sub">{{ selectedEngineUrl || 'Belum diatur' }}</span>
              </div>
              <div class="info-card glass">
                <div class="info-card-label">
                  <Cpu :size="14" />
                  <span>Ollama ({{ selectedEngineLabel }})</span>
                </div>
                <span class="info-card-value" :class="{ 'info-card-value--error': ollamaError }">
                  {{ ollamaVersion ? `v${ollamaVersion}` : (ollamaError ? 'Tidak terjangkau' : 'Memeriksa...') }}
                </span>
                <span class="info-card-sub" v-if="ollamaError">{{ ollamaError }}</span>
                <span class="info-card-sub" v-else-if="ollamaPingMs !== null">{{ ollamaPingMs }}ms</span>
              </div>
              <div class="info-card glass">
                <div class="info-card-label">
                  <HardDrive :size="14" />
                  <span>Agent Server</span>
                </div>
                <span class="info-card-value" :class="{ 'info-card-value--error': agentOk === false }">
                  {{ agentOk === null ? 'Memeriksa...' : (agentOk ? 'Terhubung' : 'Terputus') }}
                </span>
              </div>
            </div>
          </section>

          <!-- Running models (live VRAM) -->
          <section class="perf-section">
            <div class="perf-section-header">
              <span class="perf-section-title">Model Aktif di VRAM ({{ selectedEngineLabel }})</span>
              <span class="live-badge" v-if="!runningModelsError"><span class="live-dot"></span>Live</span>
            </div>
            <div v-if="runningModelsError" class="empty-state glass">
              <AlertCircle :size="15" />
              <span>{{ runningModelsError }}</span>
            </div>
            <div v-else-if="!runningModels.length && !isLoadingRunningModels" class="empty-state glass">
              <span>Tidak ada model yang sedang dimuat di VRAM saat ini.</span>
            </div>
            <div v-else class="running-models-table glass">
              <div class="running-model-row running-model-row--header">
                <span>Model</span>
                <span>Ukuran</span>
                <span>VRAM</span>
                <span>Auto-unload</span>
              </div>
              <div v-for="m in runningModels" :key="m.name" class="running-model-row">
                <span class="running-model-name" :title="m.name">{{ m.name }}</span>
                <span>{{ formatBytes(m.size) }}</span>
                <span>{{ formatBytes(m.size_vram) }}</span>
                <span class="running-model-expires"><Clock :size="11" />{{ formatExpiresIn(m.expires_at) }}</span>
              </div>
            </div>
          </section>

          <!-- Performance history + chart -->
          <section class="perf-section">
            <div class="perf-section-header">
              <span class="perf-section-title">Riwayat Kecepatan Generasi (tokens/detik)</span>
              <div class="avg-badge-group">
                <span v-for="e in perEngineAverages" :key="e.label" class="avg-badge">{{ e.label }}: {{ e.avg.toFixed(1) }} tok/s</span>
              </div>
            </div>

            <div v-if="historyError" class="empty-state glass">
              <AlertCircle :size="15" />
              <span>{{ historyError }}</span>
            </div>
            <div v-else-if="!chartEntries.length && !isLoadingHistory" class="empty-state glass">
              <span>Belum ada riwayat percakapan yang tercatat.</span>
            </div>
            <template v-else>
              <div class="chart-card glass">
                <svg
                  :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`"
                  preserveAspectRatio="none"
                  class="perf-chart"
                  @mousemove="handleChartMouseMove"
                  @mouseleave="handleChartMouseLeave"
                >
                  <!-- Gridlines + y-axis labels -->
                  <g v-for="tick in yAxisTicks" :key="tick.value">
                    <line
                      :x1="CHART_PAD_LEFT" :x2="CHART_WIDTH - CHART_PAD_RIGHT"
                      :y1="tick.y" :y2="tick.y"
                      class="chart-gridline"
                    />
                    <text :x="CHART_PAD_LEFT - 6" :y="tick.y + 3" class="chart-axis-label" text-anchor="end">
                      {{ tick.value.toFixed(0) }}
                    </text>
                  </g>

                  <!-- Area fill + line -->
                  <path :d="chartAreaPath" class="chart-area" />
                  <path :d="chartLinePath" class="chart-line" />

                  <!-- Data point markers -->
                  <circle
                    v-for="(p, i) in chartPoints" :key="p.id"
                    :cx="p.x" :cy="p.y"
                    :r="hoveredIndex === i ? 5 : 3"
                    class="chart-point"
                    :class="{ 'chart-point--hovered': hoveredIndex === i }"
                  />

                  <!-- Crosshair on hover -->
                  <line
                    v-if="hoveredPoint"
                    :x1="hoveredPoint.x" :x2="hoveredPoint.x"
                    :y1="CHART_PAD_TOP" :y2="CHART_HEIGHT - CHART_PAD_BOTTOM"
                    class="chart-crosshair"
                  />
                </svg>

                <!-- Tooltip -->
                <div
                  v-if="hoveredPoint"
                  class="chart-tooltip"
                  :style="{ left: `${(hoveredPoint.x / CHART_WIDTH) * 100}%` }"
                >
                  <strong>{{ hoveredPoint.tokPerSec.toFixed(1) }} tok/s</strong>
                  <span>{{ formatTimestamp(hoveredPoint.timestamp) }} · {{ labelForEngine(hoveredPoint.ollamaBaseUrl) }}</span>
                  <span class="chart-tooltip-model">{{ hoveredPoint.model }}</span>
                </div>
              </div>

              <!-- Recent turns table -->
              <div class="history-table glass">
                <div class="history-row history-row--header">
                  <span>Waktu</span>
                  <span>Engine</span>
                  <span>Model</span>
                  <span>Tok/s</span>
                  <span>Prompt eval</span>
                  <span>Model load</span>
                  <span>RAG</span>
                </div>
                <div v-for="h in history.slice(0, 15)" :key="h.id" class="history-row">
                  <span class="history-time">{{ formatTimestamp(h.timestamp) }}</span>
                  <span class="history-engine" :title="h.ollamaBaseUrl">{{ labelForEngine(h.ollamaBaseUrl) }}</span>
                  <span class="history-model" :title="h.model">{{ h.model }}</span>
                  <span>{{ h.evalCount && h.evalDuration ? (h.evalCount / (h.evalDuration / 1e9)).toFixed(1) : '-' }}</span>
                  <span>{{ h.promptEvalDuration ? `${(h.promptEvalDuration / 1e9).toFixed(1)}s` : '-' }}</span>
                  <span>{{ h.loadDuration && h.loadDuration / 1e9 >= 0.1 ? `${(h.loadDuration / 1e9).toFixed(1)}s` : '-' }}</span>
                  <span>
                    <span class="rag-chip" :class="h.ragEnabled ? 'rag-chip--on' : 'rag-chip--off'">
                      {{ h.ragEnabled ? 'ON' : 'OFF' }}
                    </span>
                  </span>
                </div>
              </div>
            </template>
          </section>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.performance-modal {
  width: 760px;
  max-width: 95vw;
  border-radius: 18px;
  overflow: hidden;
  animation: modalIn 0.25s ease;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
}

@keyframes modalIn {
  from { opacity: 0; transform: scale(0.96) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px 14px;
  border-bottom: 1px solid var(--color-border);
}

.modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-btn,
.close-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.icon-btn:hover,
.close-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.modal-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.engine-select-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.engine-select-label {
  font-size: 0.78rem;
  color: var(--color-text-muted);
}

.engine-select-tabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
}

.engine-select-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 7px;
  border: none;
  background: none;
  color: var(--color-text-muted);
  font-size: 0.78rem;
  font-weight: 600;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all 0.15s ease;
}

.engine-select-tab:hover {
  color: var(--color-text-primary);
}

.engine-select-tab--active {
  background: var(--color-accent);
  color: var(--color-on-accent, white);
}

.perf-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.perf-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.perf-section-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.live-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--color-success);
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-success);
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.7);
  animation: livePulse 1.4s infinite ease-in-out;
}

@keyframes livePulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.avg-badge-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.avg-badge {
  font-size: 0.72rem;
  color: var(--color-text-accent);
  background: var(--color-accent-subtle);
  padding: 2px 9px;
  border-radius: 10px;
  font-weight: 600;
  white-space: nowrap;
}

/* ---- Server info cards ---- */
.server-info-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.info-card {
  padding: 12px 14px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-card-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.7rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.info-card-value {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.info-card-value--error {
  color: var(--color-danger);
}

.info-card-sub {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- Empty / error state ---- */
.empty-state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-radius: 10px;
  color: var(--color-text-muted);
  font-size: 0.82rem;
}

/* ---- Running models table ---- */
.running-models-table,
.history-table {
  border-radius: 10px;
  overflow: hidden;
}

.running-model-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1.4fr;
  gap: 8px;
  padding: 9px 14px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
}

.running-model-row:last-child {
  border-bottom: none;
}

.running-model-row--header {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-muted);
  font-weight: 600;
  background: var(--color-bg-tertiary);
}

.running-model-name {
  color: var(--color-text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.running-model-expires {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* ---- Chart ---- */
.chart-card {
  border-radius: 10px;
  /* No horizontal padding on purpose: the SVG (preserveAspectRatio="none")
     fills this element's full width, and the crosshair tooltip's `left` is a
     percentage of that same width (see handleChartMouseMove) - any padding
     here would shift the tooltip off from the point it's supposed to sit
     above. The chart's own internal CHART_PAD_LEFT/RIGHT already reserve
     room for axis labels inside the SVG's coordinate space instead. */
  padding: 14px 0 6px;
  position: relative;
}

.perf-chart {
  width: 100%;
  height: 160px;
  display: block;
}

.chart-gridline {
  stroke: var(--color-border);
  stroke-width: 1;
}

.chart-axis-label {
  fill: var(--color-text-muted);
  font-size: 9px;
  font-family: var(--font-mono);
}

.chart-area {
  fill: var(--color-accent);
  opacity: 0.12;
  stroke: none;
}

.chart-line {
  fill: none;
  stroke: var(--color-accent);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.chart-point {
  fill: var(--color-bg-secondary);
  stroke: var(--color-accent);
  stroke-width: 1.5;
  transition: r 0.1s ease;
}

.chart-point--hovered {
  fill: var(--color-accent);
}

.chart-crosshair {
  stroke: var(--color-border-light);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.chart-tooltip {
  position: absolute;
  top: 8px;
  transform: translateX(-50%);
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-light);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 0.72rem;
  color: var(--color-text-secondary);
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  z-index: 2;
}

.chart-tooltip strong {
  color: var(--color-text-accent);
  font-size: 0.8rem;
}

.chart-tooltip-model {
  color: var(--color-text-muted);
  font-size: 0.66rem;
}

/* ---- History table ---- */
.history-row {
  display: grid;
  grid-template-columns: 1.2fr 0.9fr 1.4fr 0.7fr 0.9fr 0.9fr 0.6fr;
  gap: 8px;
  padding: 8px 14px;
  font-size: 0.76rem;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
  align-items: center;
}

.history-row:last-child {
  border-bottom: none;
}

.history-row--header {
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-muted);
  font-weight: 600;
  background: var(--color-bg-tertiary);
}

.history-time {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--color-text-muted);
}

.history-engine {
  font-size: 0.72rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-model {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rag-chip {
  font-size: 0.62rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 8px;
}

.rag-chip--on {
  background: rgba(34, 197, 94, 0.12);
  color: var(--color-success);
}

.rag-chip--off {
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
}

@media (max-width: 640px) {
  .server-info-grid {
    grid-template-columns: 1fr;
  }
  .history-row,
  .running-model-row {
    grid-template-columns: 1fr 1fr;
    row-gap: 2px;
  }
}
</style>
