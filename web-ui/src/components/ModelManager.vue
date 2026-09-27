<script setup>
import { ref, computed, onMounted } from 'vue'
import { X, Download, Trash2, RefreshCw, AlertCircle, Package, Server, Laptop, Wrench } from 'lucide-vue-next'
import { getSettings, getModels, checkEnginePing } from '../services/api.js'
import { pullModel, deleteModel, checkModelSupportsTools } from '../services/api.ts'

const emit = defineEmits(['close', 'models-changed'])

function closeModal() {
  if (isPulling.value) return
  emit('close')
}

function handleKeyDown(e) {
  if (e.key === 'Escape') closeModal()
}

// ===== Engine selection =====
// Independent from the app's active chat engine - managing models on "the
// other" engine (e.g. pre-loading something on the PC Server before
// switching to it) shouldn't require switching the whole app to it first.
const settings = getSettings()
const selectedEngine = ref(settings.activeEngine === 'pc' ? 'pc' : 'laptop')
const selectedEngineLabel = computed(() => (selectedEngine.value === 'pc' ? 'PC Server' : 'Laptop'))
const selectedEngineUrl = computed(() => (selectedEngine.value === 'pc' ? settings.pcUrl : settings.laptopUrl))

function selectEngine(engine) {
  if (selectedEngine.value === engine || isPulling.value) return
  selectedEngine.value = engine
  loadInstalledModels()
}

// ===== Installed models =====
const installedModels = ref([])
const isLoadingModels = ref(true)
const modelsError = ref('')

function formatBytes(bytes) {
  if (!bytes) return '0 MB'
  const gb = bytes / (1024 ** 3)
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`
}

function formatModifiedDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}

async function loadInstalledModels() {
  isLoadingModels.value = true
  modelsError.value = ''
  installedModels.value = []
  const url = selectedEngineUrl.value
  if (!url || !url.trim()) {
    modelsError.value = 'Alamat engine belum diatur'
    isLoadingModels.value = false
    return
  }
  try {
    // getModels() itself swallows failures into an empty array (it's built
    // for the model-picker dropdown, where "unreachable" and "genuinely no
    // models" can both just show nothing) - a ping first is what lets this
    // modal tell the two apart and say so, instead of falsely implying the
    // engine has zero models installed.
    const ping = await checkEnginePing(url)
    if (!ping.online) {
      modelsError.value = ping.error || 'Engine tidak terjangkau'
      return
    }
    installedModels.value = await getModels(url)
    loadToolSupport()
  } catch (err) {
    modelsError.value = err instanceof Error ? err.message : 'Gagal memuat daftar model'
  } finally {
    isLoadingModels.value = false
  }
}

// ===== Tool-calling support per model =====
// undefined = not checked yet, null = checking, true/false = result. Fetched
// lazily after the model list loads rather than baked into getModels() itself
// - most places that list models (the chat model picker, Model Auto) don't
// need this and would pay for an extra /api/show round trip per model for no
// reason.
const toolSupport = ref({})

async function loadToolSupport() {
  const url = selectedEngineUrl.value
  const models = installedModels.value
  toolSupport.value = Object.fromEntries(models.map((m) => [m.name, null]))
  await Promise.all(models.map(async (m) => {
    try {
      const result = await checkModelSupportsTools(m.name, url)
      toolSupport.value = { ...toolSupport.value, [m.name]: result.ok ? result.supported : false }
    } catch {
      toolSupport.value = { ...toolSupport.value, [m.name]: false }
    }
  }))
}

// ===== Delete =====
const confirmingDeleteName = ref('')
const isDeleting = ref(false)
const actionError = ref('')

function askDeleteConfirmation(modelName) {
  confirmingDeleteName.value = modelName
}

function cancelDelete() {
  confirmingDeleteName.value = ''
}

async function confirmDelete(modelName) {
  isDeleting.value = true
  actionError.value = ''
  try {
    const result = await deleteModel(modelName, selectedEngineUrl.value)
    if (!result.ok) throw new Error(result.error || 'Gagal menghapus model')
    confirmingDeleteName.value = ''
    await loadInstalledModels()
    emit('models-changed')
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : 'Gagal menghapus model'
  } finally {
    isDeleting.value = false
  }
}

// ===== Pull new model =====
const pullModelName = ref('')
const isPulling = ref(false)
const pullStatus = ref('')
const pullProgress = ref(null) // { completed, total } | null
const pullError = ref('')
let pullAbortController = null

const pullPercent = computed(() => {
  if (!pullProgress.value || !pullProgress.value.total) return null
  return Math.min(100, Math.round((pullProgress.value.completed / pullProgress.value.total) * 100))
})

async function startPull() {
  const name = pullModelName.value.trim()
  if (!name) return
  isPulling.value = true
  pullStatus.value = 'Memulai...'
  pullProgress.value = null
  pullError.value = ''
  pullAbortController = new AbortController()

  try {
    await pullModel(name, selectedEngineUrl.value, (progress) => {
      pullStatus.value = progress.status
      if (progress.total) {
        pullProgress.value = { completed: progress.completed || 0, total: progress.total }
      }
    }, pullAbortController.signal)
    pullStatus.value = 'Selesai!'
    pullModelName.value = ''
    await loadInstalledModels()
    emit('models-changed')
    setTimeout(() => { pullStatus.value = '' }, 3000)
  } catch (err) {
    if (err?.name === 'AbortError') {
      pullStatus.value = 'Dibatalkan'
    } else {
      pullError.value = err instanceof Error ? err.message : 'Gagal mengunduh model'
    }
  } finally {
    isPulling.value = false
    pullProgress.value = null
    pullAbortController = null
  }
}

function cancelPull() {
  pullAbortController?.abort()
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  loadInstalledModels()
})
</script>

<template>
  <Transition name="modal-backdrop">
    <div class="modal-backdrop" @click.self="closeModal">
      <div class="model-manager-modal glass">
        <div class="modal-header">
          <h2 class="modal-title">
            <Package :size="18" />
            Kelola Model
          </h2>
          <div class="header-actions">
            <button class="icon-btn" @click="loadInstalledModels" title="Refresh daftar model" :disabled="isLoadingModels">
              <RefreshCw :size="15" />
            </button>
            <button class="close-btn" @click="closeModal" title="Tutup" :disabled="isPulling">
              <X :size="18" />
            </button>
          </div>
        </div>

        <div class="modal-body">
          <!-- Engine selector - independent from the app's active chat engine. -->
          <div class="engine-select-row">
            <span class="engine-select-label">Kelola model di engine:</span>
            <div class="engine-select-tabs">
              <button
                class="engine-select-tab"
                :class="{ 'engine-select-tab--active': selectedEngine === 'pc' }"
                :disabled="isPulling"
                @click="selectEngine('pc')"
              >
                <Server :size="13" />
                <span>PC Server</span>
              </button>
              <button
                class="engine-select-tab"
                :class="{ 'engine-select-tab--active': selectedEngine === 'laptop' }"
                :disabled="isPulling"
                @click="selectEngine('laptop')"
              >
                <Laptop :size="13" />
                <span>Laptop</span>
              </button>
            </div>
          </div>

          <!-- Pull new model -->
          <section class="manager-section">
            <span class="manager-section-title">Unduh Model Baru ke {{ selectedEngineLabel }}</span>
            <p class="manager-section-hint">Nama model sesuai Ollama Library, contoh: <code>llama3.2:latest</code>, <code>qwen2.5-vl:7b</code></p>
            <div class="pull-input-row">
              <input
                v-model="pullModelName"
                type="text"
                class="pull-input"
                placeholder="nama-model:tag"
                :disabled="isPulling"
                @keydown.enter="startPull"
              />
              <button
                v-if="!isPulling"
                class="btn btn--primary btn--compact"
                @click="startPull"
                :disabled="!pullModelName.trim()"
              >
                <Download :size="14" />
                <span>Unduh</span>
              </button>
              <button v-else class="btn btn--secondary btn--compact" @click="cancelPull">
                <X :size="14" />
                <span>Batalkan</span>
              </button>
            </div>

            <div v-if="isPulling || pullStatus" class="pull-progress-box glass">
              <div class="pull-progress-status">{{ pullStatus }}</div>
              <div v-if="pullPercent !== null" class="pull-progress-bar-track">
                <div class="pull-progress-bar-fill" :style="{ width: `${pullPercent}%` }"></div>
              </div>
              <div v-if="pullProgress" class="pull-progress-bytes">
                {{ formatBytes(pullProgress.completed) }} / {{ formatBytes(pullProgress.total) }}
                <span v-if="pullPercent !== null">({{ pullPercent }}%)</span>
              </div>
            </div>

            <div v-if="pullError" class="empty-state glass">
              <AlertCircle :size="15" />
              <span>{{ pullError }}</span>
            </div>
          </section>

          <!-- Installed models -->
          <section class="manager-section">
            <span class="manager-section-title">Model Terpasang ({{ selectedEngineLabel }})</span>

            <div v-if="modelsError" class="empty-state glass">
              <AlertCircle :size="15" />
              <span>{{ modelsError }}</span>
            </div>
            <div v-else-if="!isLoadingModels && installedModels.length === 0" class="empty-state glass">
              <span>Belum ada model terpasang di engine ini.</span>
            </div>
            <div v-else class="model-list">
              <div v-for="m in installedModels" :key="m.name" class="model-row">
                <div class="model-row-info">
                  <div class="model-row-name-line">
                    <span class="model-row-name">{{ m.name }}</span>
                    <span
                      v-if="toolSupport[m.name] === true"
                      class="tool-support-badge tool-support-badge--yes"
                      title="Model ini mendukung tool-calling (mis. kalkulator, waktu saat ini)"
                    >
                      <Wrench :size="10" />
                      Tools
                    </span>
                    <span
                      v-else-if="toolSupport[m.name] === null"
                      class="tool-support-badge tool-support-badge--checking"
                    >
                      Memeriksa tools...
                    </span>
                  </div>
                  <span class="model-row-meta">{{ formatBytes(m.size) }} · {{ formatModifiedDate(m.modified_at) }}</span>
                </div>

                <template v-if="confirmingDeleteName === m.name">
                  <div class="confirm-delete-row">
                    <span class="confirm-delete-text">Hapus model ini?</span>
                    <button class="btn btn--danger btn--compact" @click="confirmDelete(m.name)" :disabled="isDeleting">
                      {{ isDeleting ? 'Menghapus...' : 'Ya, Hapus' }}
                    </button>
                    <button class="btn btn--secondary btn--compact" @click="cancelDelete" :disabled="isDeleting">
                      Batal
                    </button>
                  </div>
                </template>
                <button v-else class="model-delete-btn" @click="askDeleteConfirmation(m.name)" title="Hapus model ini">
                  <Trash2 :size="14" />
                </button>
              </div>
            </div>

            <div v-if="actionError" class="empty-state glass">
              <AlertCircle :size="15" />
              <span>{{ actionError }}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.model-manager-modal {
  width: 620px;
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

.icon-btn:disabled,
.close-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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

.engine-select-tab:hover:not(:disabled) {
  color: var(--color-text-primary);
}

.engine-select-tab--active {
  background: var(--color-accent);
  color: var(--color-on-accent, white);
}

.engine-select-tab:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.manager-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.manager-section-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.manager-section-hint {
  font-size: 0.74rem;
  color: var(--color-text-muted);
  margin: 0;
}

.manager-section-hint code {
  background: var(--color-bg-tertiary);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: var(--font-mono);
}

.pull-input-row {
  display: flex;
  gap: 8px;
}

.pull-input {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-input);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-family: var(--font-mono);
}

.pull-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.pull-progress-box {
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pull-progress-status {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  text-transform: capitalize;
}

.pull-progress-bar-track {
  height: 6px;
  border-radius: 3px;
  background: var(--color-bg-tertiary);
  overflow: hidden;
}

.pull-progress-bar-fill {
  height: 100%;
  background: var(--color-accent);
  border-radius: 3px;
  transition: width 0.2s ease;
}

.pull-progress-bytes {
  font-size: 0.72rem;
  font-family: var(--font-mono);
  color: var(--color-text-muted);
}

.empty-state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 10px;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
}

.model-row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.model-row-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.tool-support-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.62rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 8px;
  flex-shrink: 0;
  white-space: nowrap;
}

.tool-support-badge--yes {
  background: rgba(34, 197, 94, 0.12);
  color: var(--color-success);
}

.tool-support-badge--checking {
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
  font-weight: 500;
}

.model-row-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-row-meta {
  font-size: 0.7rem;
  color: var(--color-text-muted);
}

.model-delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border-radius: 6px;
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.model-delete-btn:hover {
  color: var(--color-danger);
  border-color: var(--color-danger);
  background: rgba(239, 68, 68, 0.1);
}

.confirm-delete-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.confirm-delete-text {
  font-size: 0.74rem;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 8px;
  font-family: var(--font-sans);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
  white-space: nowrap;
}

.btn--compact {
  padding: 7px 12px;
  font-size: 0.78rem;
}

.btn--primary {
  background: var(--color-accent);
  color: var(--color-on-accent, white);
}

.btn--primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn--secondary {
  background: var(--color-bg-tertiary);
  border-color: var(--color-border);
  color: var(--color-text-secondary);
}

.btn--secondary:hover:not(:disabled) {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.btn--danger {
  background: var(--color-danger);
  color: white;
}

.btn--danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
