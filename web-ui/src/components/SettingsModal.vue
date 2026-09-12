<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  X,
  Save,
  RotateCcw,
  Server,
  Laptop,
  Palette,
  Sliders,
  HardDrive,
  Folder,
  Download,
  Upload,
  Check,
  AlertCircle,
  RefreshCw,
  Zap,
  ArrowRightLeft,
  Wand2,
  Sparkles,
  BrainCircuit,
} from 'lucide-vue-next'
import {
  getSettings,
  saveSettingsToStorage,
  checkEnginePing,
  DEFAULT_SETTINGS,
  applyCustomTheme,
  clearCustomThemeContrast,
} from '../services/api.js'
import {
  refreshChatHistoryStorage,
  getChatHistoryRootPath,
  setChatHistoryFolder,
  clearChatHistoryFolder,
} from '../services/memory.js'
import { TASK_CATEGORIES, getDefaultModelMap } from '../services/autoModel.js'
import { getMemoryStoragePath, setMemoryStoragePath, resetMemoryStoragePath, getChatHistoryStoragePath } from '../services/api.ts'
import ServerFolderBrowser from './ServerFolderBrowser.vue'

const props = defineProps({
  conversations: {
    type: Array,
    default: () => [],
  },
  folders: {
    type: Array,
    default: () => [],
  },
  models: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['close', 'save', 'import-data', 'folder-changed'])

// Active tab in Settings: 'engine' | 'model' | 'ai' | 'theme' | 'storage'
const activeTab = ref('engine')

// Settings state
const activeEngine = ref('laptop')
const pcUrl = ref('http://192.168.1.50:11434')
const laptopUrl = ref('http://localhost:11434')
const autoFallback = ref(true)
const theme = ref('xufruz')
const initialTheme = ref('xufruz')
const customTheme = ref({ ...DEFAULT_SETTINGS.customTheme })
const initialCustomTheme = ref({ ...DEFAULT_SETTINGS.customTheme })
const showCustomThemePopup = ref(false)
let didSaveSettings = false
// Hardware-tailored num_ctx states:
// Laptop (Local) -> default 2048
const numCtxLaptop = ref(2048)
const customNumCtxLaptop = ref('')

// PC (Server) -> default 4096
const numCtxPc = ref(4096)
const customNumCtxPc = ref('')

const temperature = ref(0.7)
const maxTokens = ref('')

// ===== Chat History Storage ("Folder Penyimpanan Fisik") =====
// This only stores raw chat history (not the "real" memory system above), mediated
// by the agent-server so it can reuse the same folder-browsing UI. Empty path means
// unconfigured - the web-ui falls back to browser localStorage for chat history.
const chatHistoryPath = ref('')
const chatHistoryPathInput = ref('')
const chatHistoryStatus = ref('checking') // 'checking' | 'ready' | 'offline'
const isSavingChatHistoryPath = ref(false)
const showChatHistoryFolderBrowser = ref(false)

async function loadChatHistoryStorage() {
  chatHistoryStatus.value = 'checking'
  try {
    const info = await getChatHistoryStoragePath()
    chatHistoryPath.value = info.isConfigured ? info.chatHistoryRoot : ''
    chatHistoryPathInput.value = chatHistoryPath.value
    // Keep memory.js's cache in sync with what we just confirmed from the server.
    await refreshChatHistoryStorage()
    chatHistoryStatus.value = 'ready'
  } catch (err) {
    console.error('Failed to load chat history storage path:', err)
    chatHistoryStatus.value = 'offline'
  }
}

function openChatHistoryFolderBrowser() {
  showChatHistoryFolderBrowser.value = true
}

async function applyChatHistoryPath(explicitPath) {
  const nextPath = (explicitPath ?? chatHistoryPathInput.value).trim()
  if (!nextPath) {
    showToast('Isi path folder terlebih dahulu.')
    return
  }
  if (nextPath === chatHistoryPath.value) {
    showToast('Path tersebut sudah dipakai saat ini.')
    return
  }
  showChatHistoryFolderBrowser.value = false
  isSavingChatHistoryPath.value = true
  try {
    const info = await setChatHistoryFolder(nextPath)
    chatHistoryPath.value = info.isConfigured ? info.chatHistoryRoot : ''
    chatHistoryPathInput.value = chatHistoryPath.value
    showToast(`Folder riwayat chat dipindahkan ke "${info.chatHistoryRoot}".`)
    emit('folder-changed')
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Gagal mengatur folder riwayat chat.')
  } finally {
    isSavingChatHistoryPath.value = false
  }
}

function handleChatHistoryFolderSelected(path) {
  applyChatHistoryPath(path)
}

async function clearChatHistoryFolderSetting() {
  isSavingChatHistoryPath.value = true
  try {
    await clearChatHistoryFolder()
    chatHistoryPath.value = ''
    chatHistoryPathInput.value = ''
    showToast('Riwayat chat dikembalikan ke penyimpanan lokal browser.')
    emit('folder-changed')
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Gagal mereset folder riwayat chat.')
  } finally {
    isSavingChatHistoryPath.value = false
  }
}

// ===== Agent Server Memory Location =====
// The real memory (conversation SQLite + vector store) lives on the agent-server,
// at whatever folder path it's pointed at. Pointing it at the same folder again
// later (e.g. the same path on a flashdisk) picks the same memory back up.
const memoryStoragePath = ref('')
const memoryStoragePathInput = ref('')
const memoryStorageIsCustom = ref(false)
const memoryStorageDefaultPath = ref('')
const memoryStorageStatus = ref('checking') // 'checking' | 'ready' | 'offline'
const isSavingMemoryPath = ref(false)
const showMemoryFolderBrowser = ref(false)

async function loadMemoryStoragePath() {
  memoryStorageStatus.value = 'checking'
  try {
    const info = await getMemoryStoragePath()
    memoryStoragePath.value = info.memoryRoot
    memoryStoragePathInput.value = info.memoryRoot
    memoryStorageIsCustom.value = !!info.isCustom
    memoryStorageDefaultPath.value = info.defaultMemoryRoot
    memoryStorageStatus.value = 'ready'
  } catch (err) {
    console.error('Failed to load memory storage path:', err)
    memoryStorageStatus.value = 'offline'
  }
}

async function applyMemoryStoragePath(explicitPath) {
  const nextPath = (explicitPath ?? memoryStoragePathInput.value).trim()
  if (!nextPath) {
    showToast('Isi path folder terlebih dahulu.')
    return
  }
  if (nextPath === memoryStoragePath.value) {
    showToast('Path tersebut sudah dipakai saat ini.')
    return
  }
  isSavingMemoryPath.value = true
  try {
    const info = await setMemoryStoragePath(nextPath)
    memoryStoragePath.value = info.memoryRoot
    memoryStoragePathInput.value = info.memoryRoot
    memoryStorageIsCustom.value = !!info.isCustom
    showToast(`Lokasi ingatan dipindahkan ke "${info.memoryRoot}".`)
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Gagal mengubah lokasi ingatan.')
  } finally {
    isSavingMemoryPath.value = false
  }
}

function openMemoryFolderBrowser() {
  showMemoryFolderBrowser.value = true
}

function handleMemoryFolderSelected(path) {
  showMemoryFolderBrowser.value = false
  applyMemoryStoragePath(path)
}

async function resetMemoryStoragePathToDefault() {
  isSavingMemoryPath.value = true
  try {
    const info = await resetMemoryStoragePath()
    memoryStoragePath.value = info.memoryRoot
    memoryStoragePathInput.value = info.memoryRoot
    memoryStorageIsCustom.value = !!info.isCustom
    showToast('Lokasi ingatan dikembalikan ke default.')
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Gagal mereset lokasi ingatan.')
  } finally {
    isSavingMemoryPath.value = false
  }
}

// Ping status states (Real live check, no dummy)
const isPinging = ref({ pc: false, laptop: false })
const pingResult = ref({
  pc: null, // { online: true, ms: 12, version: '...' }
  laptop: null,
})

// ===== Model Auto =====
const autoModelEnabled = ref(false)
const autoModelMapLaptop = ref({})
const autoModelMapPc = ref({})

const activeAutoModelMap = computed(() => (
  activeEngine.value === 'pc' ? autoModelMapPc.value : autoModelMapLaptop.value
))

function setAutoModelChoice(category, modelName) {
  const target = activeEngine.value === 'pc' ? autoModelMapPc : autoModelMapLaptop
  target.value = { ...target.value, [category]: modelName }
}

function applyDefaultAutoModelMap() {
  const defaults = getDefaultModelMap(props.models)
  if (activeEngine.value === 'pc') {
    autoModelMapPc.value = { ...defaults }
  } else {
    autoModelMapLaptop.value = { ...defaults }
  }
  showToast('Pemetaan model default diterapkan untuk ' + (activeEngine.value === 'pc' ? 'PC Server' : 'Laptop') + '.')
}

function getModelOptionName(model) {
  return typeof model === 'string' ? model : (model?.name || '')
}

// Toast notification inside modal
const modalToast = ref('')
let toastTimer = null

function showToast(msg) {
  modalToast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    modalToast.value = ''
  }, 4000)
}

function handleKeyDown(e) {
  if (e.key === 'Escape') {
    closeModal()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  loadCurrentSettings()
  // Only ping if real URL is configured
  if (laptopUrl.value && laptopUrl.value.trim()) {
    pingEngine('laptop')
  }
  if (pcUrl.value && pcUrl.value.trim()) {
    pingEngine('pc')
  }
  loadMemoryStoragePath()
  loadChatHistoryStorage()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  // Only discard live preview changes when Settings was closed without saving.
  if (!didSaveSettings) {
    document.documentElement.setAttribute('data-theme', initialTheme.value)
    if (initialTheme.value === 'custom') applyCustomTheme(initialCustomTheme.value)
    else clearCustomThemeContrast()
  }
})

function loadCurrentSettings() {
  const s = getSettings()
  activeEngine.value = s.activeEngine || 'laptop'
  pcUrl.value = s.pcUrl ? s.pcUrl : 'http://192.168.1.50:11434'
  laptopUrl.value = s.laptopUrl ? s.laptopUrl : 'http://localhost:11434'
  autoFallback.value = s.autoFallback !== false
  theme.value = s.theme || 'xufruz'
  initialTheme.value = s.theme || 'xufruz'
  customTheme.value = { ...DEFAULT_SETTINGS.customTheme, ...(s.customTheme || {}) }
  initialCustomTheme.value = { ...customTheme.value }
  if (theme.value === 'custom') applyCustomTheme(customTheme.value)
  else clearCustomThemeContrast()
  temperature.value = s.temperature !== undefined && s.temperature !== '' ? Number(s.temperature) : 0.7
  maxTokens.value = s.maxTokens ?? ''

  autoModelEnabled.value = !!s.autoModelEnabled
  autoModelMapLaptop.value = { ...(s.autoModelMapLaptop || {}) }
  autoModelMapPc.value = { ...(s.autoModelMapPc || {}) }

  // Load Context Window for Laptop (RTX 2050 4GB)
  const rawLaptop = s.numCtxLaptop || (s.activeEngine === 'laptop' ? s.numCtx : 2048) || 2048
  if ([1024, 2048, 3072, 4096].includes(Number(rawLaptop))) {
    numCtxLaptop.value = Number(rawLaptop)
    customNumCtxLaptop.value = ''
  } else {
    numCtxLaptop.value = 'custom'
    customNumCtxLaptop.value = String(rawLaptop)
  }

  // Load Context Window for PC Server (RX 580 8GB)
  const rawPc = s.numCtxPc || (s.activeEngine === 'pc' ? s.numCtx : 4096) || 4096
  if ([2048, 4096, 8192, 16384].includes(Number(rawPc))) {
    numCtxPc.value = Number(rawPc)
    customNumCtxPc.value = ''
  } else {
    numCtxPc.value = 'custom'
    customNumCtxPc.value = String(rawPc)
  }
}

// ===== Engine Switcher & Ping =====
function selectEngine(target) {
  activeEngine.value = target
  if (target === 'pc' && (!pcUrl.value || !pcUrl.value.trim())) {
    showToast('Silakan isi alamat IP LAN PC Server terlebih dahulu.')
    return
  }
  pingEngine(target)
}

async function pingEngine(type) {
  const url = type === 'pc' ? pcUrl.value : laptopUrl.value
  if (!url || !url.trim()) {
    pingResult.value[type] = { online: false, notConfigured: true, error: 'Belum diatur' }
    return
  }
  isPinging.value[type] = true
  try {
    const res = await checkEnginePing(url)
    pingResult.value[type] = res
  } finally {
    isPinging.value[type] = false
  }
}

// ===== Temperature Helpers =====
const temperatureDesc = computed(() => {
  const t = Number(temperature.value)
  if (t <= 0.2) return { label: 'Presisi & Koding', desc: 'Deterministik, minim halusinasi, ideal untuk kode & logika ketat.' }
  if (t <= 0.5) return { label: 'Faktual & Terstruktur', desc: 'Ringkasan akurat, analisis data, dan penjelasan terfokus.' }
  if (t <= 0.75) return { label: 'Seimbang (Default)', desc: 'Bahasa alami, percakapan umum yang mengalir dan koheren.' }
  return { label: 'Kreatif & Eksploratif', desc: 'Brainstorming, penulisan cerita, dan eksplorasi ide bebas.' }
})

function setTemperaturePreset(val) {
  temperature.value = val
}

function setNumCtxPreset(val) {
  if (activeEngine.value === 'pc') {
    numCtxPc.value = val
    if (val !== 'custom') {
      customNumCtxPc.value = ''
    }
  } else {
    numCtxLaptop.value = val
    if (val !== 'custom') {
      customNumCtxLaptop.value = ''
    }
  }
}

// Live performance estimation based on active mode (PC Server vs Laptop Local)
const vramStatus = computed(() => {
  const isPc = activeEngine.value === 'pc'
  const ctxVal = isPc
    ? (numCtxPc.value === 'custom' ? parseInt(customNumCtxPc.value) || 4096 : numCtxPc.value)
    : (numCtxLaptop.value === 'custom' ? parseInt(customNumCtxLaptop.value) || 2048 : numCtxLaptop.value)

  if (isPc) {
    // PC (Server)
    if (ctxVal <= 2048) {
      return {
        level: 'vram--safe',
        title: 'Sangat Hemat & Respon Cepat',
        estimate: 'Beban Ringan',
        description: 'Respon model instan dengan sisa memori sangat lega.',
      }
    } else if (ctxVal <= 4096) {
      return {
        level: 'vram--optimal',
        title: 'Optimal & Seimbang',
        estimate: 'Beban Optimal',
        description: 'Kapasitas context window ideal tanpa penurunan performa.',
      }
    } else if (ctxVal <= 8192) {
      return {
        level: 'vram--good',
        title: 'Kapasitas Luas (Dokumen & Kode Panjang)',
        estimate: 'Kapasitas Luas',
        description: 'Mampu memproses percakapan panjang',
      }
    } else {
      return {
        level: 'vram--warning',
        title: 'Beban Ekstra Tinggi',
        estimate: 'Kapasitas Maksimal',
        description: 'Disarankan untuk model berukuran kecil/sedang agar tetap efisien.',
      }
    }
  } else {
    // Laptop (Local)
    if (ctxVal <= 1024) {
      return {
        level: 'vram--safe',
        title: 'Ultra Ringan',
        estimate: 'Beban Ringan',
        description: 'Respon model cepat dan hemat daya.',
      }
    } else if (ctxVal <= 2048) {
      return {
        level: 'vram--optimal',
        title: 'Optimal',
        estimate: 'Beban Optimal',
        description: 'Berjalan stabil, lancar, dan responsif.',
      }
    } else if (ctxVal <= 3072) {
      return {
        level: 'vram--good',
        title: 'Beban Sedang',
        estimate: 'Beban Sedang',
        description: 'Cocok untuk model-model berukuran ringan',
      }
    } else {
      return {
        level: 'vram--warning',
        title: 'Beban Tinggi',
        estimate: 'Beban Tinggi',
        description: 'Kecepatan generasi teks mungkin berkurang pada percakapan panjang.',
      }
    }
  }
})

// ===== Themes =====
const themesList = [
  {
    id: 'xufruz',
    name: 'Xufruz Purple',
    desc: 'Deep violet sleek neon',
    bg: '#0a0a12',
    accent: '#8b5cf6',
    text: '#e4e4ed',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk Emerald',
    desc: 'Matrix high-tech teal',
    bg: '#06110f',
    accent: '#10b981',
    text: '#e2f5ee',
  },
  {
    id: 'oled',
    name: 'Midnight OLED',
    desc: 'True pure black #000000',
    bg: '#000000',
    accent: '#3b82f6',
    text: '#f3f4f6',
  },
  {
    id: 'light',
    name: 'Clean Light',
    desc: 'Nuansa putih terang & jernih',
    bg: '#f8fafc',
    accent: '#4f46e5',
    text: '#0f172a',
  },
  {
    id: 'grey',
    name: 'Graphite Grey',
    desc: 'Abu-abu modern & fokus tinggi',
    bg: '#18191c',
    accent: '#64748b',
    text: '#f3f4f6',
  },
  {
    id: 'custom',
    name: 'Custom Theme',
    desc: 'Atur tiga warna sesuai selera',
    bg: '#10131a',
    accent: '#22c55e',
    text: '#f3f4f6',
  },
]

function selectTheme(tId) {
  theme.value = tId
  if (tId === 'custom') applyCustomTheme(customTheme.value)
  else clearCustomThemeContrast()
  // Berikan live preview sementara langsung ke tampilan
  document.documentElement.setAttribute('data-theme', tId)
  if (tId === 'custom') showCustomThemePopup.value = true
}

function getThemeCardStyle(themeOption) {
  const isCustom = themeOption.id === 'custom'
  const colors = isCustom
    ? customTheme.value
    : themeOption

  return {
    '--theme-card-bg': colors.background || colors.bg,
    '--theme-card-accent': colors.accent,
    '--theme-card-text': isCustom ? 'var(--custom-readable-text, var(--custom-text))' : colors.text,
    background: colors.background || colors.bg,
    borderColor: colors.accent,
  }
}

function updateCustomColor(name, value) {
  customTheme.value = { ...customTheme.value, [name]: value }
  if (theme.value === 'custom') applyCustomTheme(customTheme.value)
}


function exportJsonFile() {
  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    folders: props.folders,
    conversations: props.conversations,
  }
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `chat-history-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  showToast('File JSON riwayat chat berhasil diunduh.')
}

function handleFileInput(e) {
  const file = e.target.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (event) => {
    try {
      const parsed = JSON.parse(event.target.result)
      if (parsed && (parsed.conversations || Array.isArray(parsed))) {
        emit('import-data', parsed)
        showToast('Riwayat chat berhasil dipulihkan dari file JSON!')
      } else {
        showToast('Format file JSON tidak valid.')
      }
    } catch (err) {
      showToast('Gagal membaca file JSON.')
    }
  }
  reader.readAsText(file)
  e.target.value = ''
}

// ===== Close, Save & Reset =====
function closeModal() {
  // Close modal without reverting theme preview
  emit('close')
}

function saveSettings() {
  const finalLaptopCtx = numCtxLaptop.value === 'custom' ? parseInt(customNumCtxLaptop.value) || 2048 : numCtxLaptop.value
  const finalPcCtx = numCtxPc.value === 'custom' ? parseInt(customNumCtxPc.value) || 4096 : numCtxPc.value
  const activeFinalCtx = activeEngine.value === 'pc' ? finalPcCtx : finalLaptopCtx

  const settings = {
    activeEngine: activeEngine.value,
    pcUrl: pcUrl.value.trim(),
    laptopUrl: laptopUrl.value.trim(),
    autoFallback: autoFallback.value,
    theme: theme.value,
    customTheme: { ...customTheme.value },
    numCtx: activeFinalCtx,
    numCtxLaptop: finalLaptopCtx,
    numCtxPc: finalPcCtx,
    temperature: parseFloat(temperature.value),
    maxTokens: maxTokens.value !== '' ? parseInt(maxTokens.value) : '',
    autoModelEnabled: autoModelEnabled.value,
    autoModelMapLaptop: { ...autoModelMapLaptop.value },
    autoModelMapPc: { ...autoModelMapPc.value },
  }

  saveSettingsToStorage(settings)
  didSaveSettings = true
  // Simpan tema secara permanen
  initialTheme.value = theme.value
  initialCustomTheme.value = { ...customTheme.value }
  document.documentElement.setAttribute('data-theme', theme.value)
  if (theme.value === 'custom') applyCustomTheme(customTheme.value)
  else clearCustomThemeContrast()
  emit('save', settings)
  emit('close')
}

function resetDefaults() {
  activeEngine.value = DEFAULT_SETTINGS.activeEngine || 'laptop'
  pcUrl.value = DEFAULT_SETTINGS.pcUrl || 'http://192.168.1.50:11434'
  laptopUrl.value = DEFAULT_SETTINGS.laptopUrl || 'http://localhost:11434'
  autoFallback.value = DEFAULT_SETTINGS.autoFallback !== false
  const defaultTheme = DEFAULT_SETTINGS.theme || 'xufruz'
  theme.value = defaultTheme
  document.documentElement.setAttribute('data-theme', defaultTheme)
  customTheme.value = { ...DEFAULT_SETTINGS.customTheme }
  clearCustomThemeContrast()
  numCtxLaptop.value = DEFAULT_SETTINGS.numCtxLaptop || 2048
  customNumCtxLaptop.value = ''
  numCtxPc.value = DEFAULT_SETTINGS.numCtxPc || 4096
  customNumCtxPc.value = ''
  temperature.value = DEFAULT_SETTINGS.temperature
  maxTokens.value = DEFAULT_SETTINGS.maxTokens
  autoModelEnabled.value = DEFAULT_SETTINGS.autoModelEnabled || false
  autoModelMapLaptop.value = {}
  autoModelMapPc.value = {}
  showToast('Pengaturan direset ke default. Klik "Simpan Perubahan" untuk menerapkan atau X untuk membatalkan.')
}
</script>

<template>
  <Transition name="modal-backdrop">
    <div class="modal-backdrop" @click.self="closeModal">
      <div class="settings-modal glass">
        <!-- Header -->
        <div class="modal-header">
          <div class="modal-header-info">
            <h2 class="modal-title">Settings</h2>
          </div>
          <button class="close-btn" @click="closeModal" id="close-settings-btn" title="Tutup">
            <X :size="18" />
          </button>
        </div>

        <!-- Navigation Tabs -->
        <div class="settings-tabs">
          <button
            class="tab-btn"
            :class="{ 'tab-btn--active': activeTab === 'engine' }"
            @click="activeTab = 'engine'"
          >
            <Server :size="15" />
            <span>Mesin & Koneksi</span>
          </button>

          <button
            class="tab-btn"
            :class="{ 'tab-btn--active': activeTab === 'model' }"
            @click="activeTab = 'model'"
          >
            <Wand2 :size="15" />
            <span>Model Auto</span>
          </button>

          <button
            class="tab-btn"
            :class="{ 'tab-btn--active': activeTab === 'ai' }"
            @click="activeTab = 'ai'"
          >
            <Sliders :size="15" />
            <span>Parameter AI</span>
          </button>

          <button
            class="tab-btn"
            :class="{ 'tab-btn--active': activeTab === 'theme' }"
            @click="activeTab = 'theme'"
          >
            <Palette :size="15" />
            <span>Tema</span>
          </button>

          <button
            class="tab-btn"
            :class="{ 'tab-btn--active': activeTab === 'storage' }"
            @click="activeTab = 'storage'"
          >
            <HardDrive :size="15" />
            <span>Penyimpanan</span>
          </button>
        </div>

        <!-- Toast Notification inside modal -->
        <Transition name="fade">
          <div v-if="modalToast" class="modal-toast-banner glass">
            <AlertCircle :size="14" />
            <span>{{ modalToast }}</span>
          </div>
        </Transition>

        <!-- Body -->
        <div class="modal-body">
          <!-- TAB 1: MESIN & KONEKSI -->
          <div v-if="activeTab === 'engine'" class="tab-pane">
            <div class="section-title-group">
              <span class="section-title">Target Engine Switcher</span>
            </div>

            <!-- Engine Cards Switcher -->
            <div class="engine-cards-grid">
              <!-- PC SERVER CARD -->
              <div
                class="engine-card"
                :class="{ 'engine-card--active': activeEngine === 'pc' }"
                @click="selectEngine('pc')"
              >
                <div class="engine-card-top">
                  <div class="engine-icon-wrapper">
                    <Server :size="20" class="engine-icon" />
                  </div>
                  <div class="engine-meta">
                    <div class="engine-title-row">
                      <span class="engine-name">PC Server</span>
                      <span v-if="activeEngine === 'pc'" class="engine-badge engine-badge--active">Aktif</span>
                    </div>
                    <span class="engine-role">Koneksi LAN</span>
                  </div>
                </div>

                <!-- Ping Info PC Server (Real Check) -->
                <div class="engine-ping-bar">
                  <div class="ping-status">
                    <span
                      class="ping-dot"
                      :class="{
                        'ping-dot--online': pingResult.pc?.online,
                        'ping-dot--offline': pingResult.pc && !pingResult.pc.online && !pingResult.pc.notConfigured,
                        'ping-dot--loading': isPinging.pc,
                      }"
                    ></span>
                    <span class="ping-text">
                      <template v-if="isPinging.pc">Memeriksa koneksi...</template>
                      <template v-else-if="!pcUrl || !pcUrl.trim()">Belum diatur</template>
                      <template v-else-if="pingResult.pc?.online">{{ pingResult.pc.ms }}ms (Online)</template>
                      <template v-else-if="pingResult.pc">{{ pingResult.pc.error || 'Tidak Terhubung' }}</template>
                      <template v-else>Klik Ping untuk cek</template>
                    </span>
                  </div>
                  <button
                    class="btn-ping"
                    @click.stop="pingEngine('pc')"
                    :disabled="isPinging.pc || !pcUrl || !pcUrl.trim()"
                    title="Cek koneksi nyata ke PC Server"
                  >
                    <RefreshCw :size="12" :class="{ spinning: isPinging.pc }" />
                    <span>Ping</span>
                  </button>
                </div>

                <!-- PC Server URL Input -->
                <div class="form-group engine-input-group" @click.stop>
                  <label class="form-label-micro">Alamat PC Server (LAN)</label>
                  <input
                    v-model="pcUrl"
                    type="text"
                    class="form-input form-input--compact"
                    placeholder="http://192.168.1.50:11434"
                  />
                </div>
              </div>

              <!-- LAPTOP CARD -->
              <div
                class="engine-card"
                :class="{ 'engine-card--active': activeEngine === 'laptop' }"
                @click="selectEngine('laptop')"
              >
                <div class="engine-card-top">
                  <div class="engine-icon-wrapper">
                    <Laptop :size="20" class="engine-icon" />
                  </div>
                  <div class="engine-meta">
                    <div class="engine-title-row">
                      <span class="engine-name">Laptop</span>
                      <span v-if="activeEngine === 'laptop'" class="engine-badge engine-badge--active">Aktif</span>
                    </div>
                    <span class="engine-role">Koneksi Localhost</span>
                  </div>
                </div>

                <!-- Ping Info Laptop (Real Check) -->
                <div class="engine-ping-bar">
                  <div class="ping-status">
                    <span
                      class="ping-dot"
                      :class="{
                        'ping-dot--online': pingResult.laptop?.online,
                        'ping-dot--offline': pingResult.laptop && !pingResult.laptop.online && !pingResult.laptop.notConfigured,
                        'ping-dot--loading': isPinging.laptop,
                      }"
                    ></span>
                    <span class="ping-text">
                      <template v-if="isPinging.laptop">Memeriksa koneksi...</template>
                      <template v-else-if="!laptopUrl || !laptopUrl.trim()">Belum diatur</template>
                      <template v-else-if="pingResult.laptop?.online">{{ pingResult.laptop.ms }}ms (Online)</template>
                      <template v-else-if="pingResult.laptop">{{ pingResult.laptop.error || 'Tidak Terhubung' }}</template>
                      <template v-else>Klik Ping untuk cek</template>
                    </span>
                  </div>
                  <button
                    class="btn-ping"
                    @click.stop="pingEngine('laptop')"
                    :disabled="isPinging.laptop || !laptopUrl || !laptopUrl.trim()"
                    title="Cek koneksi LLM Laptop"
                  >
                    <RefreshCw :size="12" :class="{ spinning: isPinging.laptop }" />
                    <span>Ping</span>
                  </button>
                </div>

                <!-- Laptop URL Input -->
                <div class="form-group engine-input-group" @click.stop>
                  <label class="form-label-micro">Alamat Laptop (Localhost)</label>
                  <input
                    v-model="laptopUrl"
                    type="text"
                    class="form-input form-input--compact"
                    placeholder="http://localhost:11434"
                  />
                </div>
              </div>
            </div>

            <!-- Auto-Fallback Connection Toggle -->
            <div class="setting-toggle-box glass">
              <div class="toggle-info">
                <div class="toggle-title-row">
                  <Zap :size="15" class="toggle-icon" />
                  <span class="toggle-title">Auto-Fallback Connection</span>
                </div>
              </div>
              <label class="switch">
                <input v-model="autoFallback" type="checkbox" />
                <span class="slider round"></span>
              </label>
            </div>
          </div>

          <!-- TAB: MODEL AUTO -->
          <div v-if="activeTab === 'model'" class="tab-pane">
            <div class="section-title-group">
              <span class="section-title">Model Auto</span>
            </div>

            <!-- Enable Toggle -->
            <div class="setting-toggle-box glass">
              <div class="toggle-info">
                <div class="toggle-title-row">
                  <Wand2 :size="15" class="toggle-icon" />
                  <label class="form-label">
                    Aktifkan Mode Otomatis &bull &bull;
                    <span class="active-gpu-label">{{ activeEngine === 'pc' ? 'PC (Server)' : 'Laptop (Local)' }}</span>
                  </label>
                </div>
              </div>
              <label class="switch">
                <input v-model="autoModelEnabled" type="checkbox" />
                <span class="slider round"></span>
              </label>
            </div>
            <span class="section-title">Pengaturan Model</span>
            <div class="model-map-header">
              <button
                class="btn btn--secondary btn--compact model-map-default-btn"
                @click="applyDefaultAutoModelMap"
                :disabled="models.length === 0"
                type="button"
              >
                <Sparkles :size="13" />
                Gunakan Default
              </button>
            </div>

            <div v-if="models.length === 0" class="section-empty-hint">
              Tidak ada model terdeteksi di perangkat ini. Pastikan mesin terhubung dan model sudah terpasang di Ollama.
            </div>

            <div v-else class="model-map-list">
              <div v-for="cat in TASK_CATEGORIES" :key="cat.id" class="model-map-row">
                <div class="model-map-info">
                  <span class="model-map-label">{{ cat.label }}</span>
                  <span class="model-map-desc">{{ cat.desc }}</span>
                </div>
                <select
                  class="form-input form-input--compact model-map-select"
                  :value="activeAutoModelMap[cat.id] || ''"
                  @change="setAutoModelChoice(cat.id, $event.target.value)"
                >
                  <option value="">— Pilih model —</option>
                  <option v-for="m in models" :key="getModelOptionName(m)" :value="getModelOptionName(m)">
                    {{ getModelOptionName(m) }}
                  </option>
                </select>
              </div>
            </div>
          </div>

          <!-- TAB 2: PARAMETER AI (num_ctx & Temperature) -->
          <div v-if="activeTab === 'ai'" class="tab-pane">

            <!-- Context Window (num_ctx) -->
            <div class="form-group context-window-card">
              <div class="label-with-badge">
                <label class="form-label">
                  Context Window (num_ctx) &bull;
                  <span class="active-gpu-label">{{ activeEngine === 'pc' ? 'PC (Server)' : 'Laptop (Local)' }}</span>
                </label>
              </div>

              <!-- LAPTOP (LOCAL) PRESETS -->
              <div v-if="activeEngine === 'laptop'" class="preset-chips-row">
                <button
                  class="chip-btn"
                  :class="{ 'chip-btn--active': numCtxLaptop === 1024 }"
                  @click="setNumCtxPreset(1024)"
                >
                  <span class="chip-main">1024 Token</span>
                  <span class="chip-sub">Ultra Ringan</span>
                </button>

                <button
                  class="chip-btn"
                  :class="{ 'chip-btn--active': numCtxLaptop === 2048 }"
                  @click="setNumCtxPreset(2048)"
                >
                  <span class="chip-main">2048 Token</span>
                  <span class="chip-sub chip-sub--star">Rekomendasi</span>
                </button>

                <button
                  class="chip-btn"
                  :class="{ 'chip-btn--active': numCtxLaptop === 3072 }"
                  @click="setNumCtxPreset(3072)"
                >
                  <span class="chip-main">3072 Token</span>
                  <span class="chip-sub">Model Ringan</span>
                </button>

                <button
                  class="chip-btn"
                  :class="{ 'chip-btn--active': numCtxLaptop === 4096 }"
                  @click="setNumCtxPreset(4096)"
                >
                  <span class="chip-main">4096 Token</span>
                  <span class="chip-sub">Beban Tinggi</span>
                </button>

                <button
                  class="chip-btn"
                  :class="{ 'chip-btn--active': numCtxLaptop === 'custom' }"
                  @click="setNumCtxPreset('custom')"
                >
                  <span class="chip-main">Kustom</span>
                  <span class="chip-sub">Manual</span>
                </button>
              </div>

              <!-- PC (SERVER) PRESETS -->
              <div v-else class="preset-chips-row">
                <button
                  class="chip-btn"
                  :class="{ 'chip-btn--active': numCtxPc === 2048 }"
                  @click="setNumCtxPreset(2048)"
                >
                  <span class="chip-main">2048 Token</span>
                  <span class="chip-sub">Cepat & Ringan</span>
                </button>

                <button
                  class="chip-btn"
                  :class="{ 'chip-btn--active': numCtxPc === 4096 }"
                  @click="setNumCtxPreset(4096)"
                >
                  <span class="chip-main">4096 Token</span>
                  <span class="chip-sub chip-sub--star">Rekomendasi</span>
                </button>

                <button
                  class="chip-btn"
                  :class="{ 'chip-btn--active': numCtxPc === 8192 }"
                  @click="setNumCtxPreset(8192)"
                >
                  <span class="chip-main">8192 Token</span>
                  <span class="chip-sub">Dokumen Panjang</span>
                </button>

                <button
                  class="chip-btn"
                  :class="{ 'chip-btn--active': numCtxPc === 16384 }"
                  @click="setNumCtxPreset(16384)"
                >
                  <span class="chip-main">16384 Token</span>
                  <span class="chip-sub">Ultra Panjang</span>
                </button>

                <button
                  class="chip-btn"
                  :class="{ 'chip-btn--active': numCtxPc === 'custom' }"
                  @click="setNumCtxPreset('custom')"
                >
                  <span class="chip-main">Kustom</span>
                  <span class="chip-sub">Manual</span>
                </button>
              </div>

              <!-- Custom num_ctx input -->
              <div v-if="(activeEngine === 'laptop' && numCtxLaptop === 'custom') || (activeEngine === 'pc' && numCtxPc === 'custom')" class="custom-input-box">
                <input
                  v-if="activeEngine === 'laptop'"
                  v-model="customNumCtxLaptop"
                  type="text"
                  class="form-input form-input--compact"
                  placeholder="Contoh: 2560 (Laptop)"
                  min="512"
                  max="8192"
                  step="512"
                />
                <input
                  v-else
                  v-model="customNumCtxPc"
                  type="text"
                  class="form-input form-input--compact"
                  placeholder="Contoh: 6144 (PC Server)"
                  min="512"
                  max="32768"
                  step="512"
                />
              </div>

              <!-- Performance Status Card -->
              <div class="vram-estimate-box" :class="vramStatus.level">
                <div class="vram-estimate-row">
                  <div class="vram-estimate-label">
                    <span class="vram-dot"></span>
                    <strong>Status {{ activeEngine === 'pc' ? 'PC (Server)' : 'Laptop (Local)' }}:</strong>
                    <span>{{ vramStatus.title }}</span>
                  </div>
                  <span class="vram-usage-badge">{{ vramStatus.estimate }}</span>
                </div>
                <span class="vram-estimate-desc">{{ vramStatus.description }}</span>
              </div>
            </div>

            <!-- Temperature Slider -->
            <div class="form-group">
              <div class="label-with-badge">
                <label class="form-label">Temperature: {{ Number(temperature).toFixed(2) }}</label>
                <span class="chip-info chip-info--highlight">{{ temperatureDesc.label }}</span>
              </div>
              <p class="form-hint">{{ temperatureDesc.desc }}</p>

              <!-- Slider control -->
              <div class="slider-wrapper">
                <input
                  v-model.number="temperature"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  class="range-slider"
                />
                <div class="slider-ticks">
                  <span @click="setTemperaturePreset(0.0)">0.0 (Presisi)</span>
                  <span @click="setTemperaturePreset(0.5)">0.5</span>
                  <span @click="setTemperaturePreset(0.7)">0.7 (Default)</span>
                  <span @click="setTemperaturePreset(1.0)">1.0 (Kreatif)</span>
                </div>
              </div>

              <!-- Quick Presets for Temperature -->
              <div class="preset-buttons-row">
                <button
                  class="btn-micro-preset"
                  :class="{ 'btn-micro-preset--active': Number(temperature) === 0.1 }"
                  @click="setTemperaturePreset(0.1)"
                >
                  0.1 Koding & Logika
                </button>
                <button
                  class="btn-micro-preset"
                  :class="{ 'btn-micro-preset--active': Number(temperature) === 0.7 }"
                  @click="setTemperaturePreset(0.7)"
                >
                  0.7 Seimbang (Umum)
                </button>
                <button
                  class="btn-micro-preset"
                  :class="{ 'btn-micro-preset--active': Number(temperature) === 1.0 }"
                  @click="setTemperaturePreset(1.0)"
                >
                  1.0 Kreatif
                </button>
              </div>
            </div>

            <!-- Max Tokens -->
            <div class="form-group">
              <label for="max-tokens-input" class="form-label">Max Tokens (num_predict)</label>
              <input
                id="max-tokens-input"
                v-model="maxTokens"
                type="text"
                class="form-input form-input--compact"
                placeholder="Kosongkan untuk tanpa batas (unlimited)"
                min="1"
              />
              <p class="form-hint">Batas maksimum token balasan yang dihasilkan LLM.</p>
            </div>
          </div>

          <!-- TAB 3: TEMA TAMPILAN -->
          <div v-if="activeTab === 'theme'" class="tab-pane">
            <div class="section-title-group">
              <span class="section-title">Pilih Skema Warna UI</span>
            </div>

            <div class="themes-grid">
              <div
                v-for="t in themesList"
                :key="t.id"
                class="theme-card"
                :class="{ 'theme-card--active': theme === t.id }"
                :style="getThemeCardStyle(t)"
                @click="selectTheme(t.id)"
              >
                <div
                  class="theme-swatch-box"
                  :style="{
                    background: t.id === 'custom'
                      ? `linear-gradient(135deg, ${customTheme.background} 0 45%, ${customTheme.accent} 45% 72%, ${customTheme.text} 72% 100%)`
                      : t.bg,
                  }"
                >
                  <template v-if="t.id === 'custom'">
                    <div class="theme-custom-color-chip" :style="{ background: customTheme.background }"></div>
                    <div class="theme-custom-color-chip" :style="{ background: customTheme.accent }"></div>
                    <div class="theme-custom-color-chip" :style="{ background: customTheme.text }"></div>
                  </template>
                  <template v-else>
                    <div class="theme-accent-pill" :style="{ background: t.accent }"></div>
                    <div class="theme-sub-pill" :style="{ background: t.accent, opacity: 0.25 }"></div>
                  </template>
                </div>
                <div class="theme-info">
                  <div class="theme-name-row">
                    <span class="theme-name">{{ t.name }}</span>
                    <Check v-if="theme === t.id" :size="14" class="theme-check-icon" />
                  </div>
                  <span class="theme-desc">{{ t.desc }}</span>
                </div>
              </div>
            </div>

          </div>

          <!-- TAB 4: PENYIMPANAN / MEMORY (.json) -->
          <div v-if="activeTab === 'storage'" class="tab-pane">
            <div class="section-title-group">
              <span class="section-title">Penyimpanan</span>
            </div>

            <!-- Physical Folder Picker -->
            <div class="storage-box glass">
              <div class="storage-box-header">
                <div class="storage-icon-circle">
                  <Folder :size="18" />
                </div>
                <div class="storage-header-text">
                  <span class="storage-box-title">Folder Penyimpanan Fisik</span>
                  <span class="storage-box-sub">
                    <template v-if="chatHistoryStatus === 'checking'">Memeriksa folder riwayat chat...</template>
                    <template v-else-if="chatHistoryStatus === 'offline'">Agent-server tidak terhubung.</template>
                    <template v-else-if="chatHistoryPath">Folder Terhubung: {{ chatHistoryPath }}</template>
                    <template v-else>Belum ada folder fisik yang dipilih (memakai penyimpanan lokal browser)</template>
                  </span>
                </div>
              </div>

              <div class="storage-actions-row">
                <button
                  class="btn btn--secondary memory-folder-button"
                  @click="openChatHistoryFolderBrowser"
                  :disabled="chatHistoryStatus !== 'ready' || isSavingChatHistoryPath"
                >
                  <Folder :size="14" />
                  <span>{{ chatHistoryPath ? 'Ganti Folder' : 'Pilih Folder (Laptop / Flashdisk)' }}</span>
                </button>
              </div>

              <details class="memory-path-manual">
                <summary>Atau ketik path folder secara manual</summary>
                <div class="memory-path-input-row">
                  <input
                    v-model="chatHistoryPathInput"
                    type="text"
                    class="form-input form-input--compact"
                    placeholder="Contoh: D:\chat-history atau /mnt/flashdisk/chat-history"
                    :disabled="chatHistoryStatus !== 'ready' || isSavingChatHistoryPath"
                  />
                  <button
                    class="btn btn--secondary btn--compact memory-path-apply-btn"
                    @click="applyChatHistoryPath()"
                    :disabled="chatHistoryStatus !== 'ready' || isSavingChatHistoryPath"
                  >
                    <Save :size="13" />
                    <span>Terapkan</span>
                  </button>
                </div>
              </details>

              <button
                v-if="chatHistoryPath"
                class="btn-link-reset"
                @click="clearChatHistoryFolderSetting"
                :disabled="isSavingChatHistoryPath"
                type="button"
              >
                Kembalikan ke penyimpanan lokal browser
              </button>
            </div>

            <ServerFolderBrowser
              v-if="showChatHistoryFolderBrowser"
              :initial-path="chatHistoryPath"
              @select="handleChatHistoryFolderSelected"
              @close="showChatHistoryFolderBrowser = false"
            />

            <!-- Agent Server Memory Location -->
            <div class="storage-box glass">
              <div class="storage-box-header">
                <div class="storage-icon-circle">
                  <BrainCircuit :size="18" />
                </div>
                <div class="storage-header-text">
                  <span class="storage-box-title">Lokasi Penyimpanan Ingatan (Memory)</span>
                  <span class="storage-box-sub">
                    <template v-if="memoryStorageStatus === 'checking'">Memeriksa lokasi ingatan...</template>
                    <template v-else-if="memoryStorageStatus === 'offline'">Agent-server tidak terhubung.</template>
                    <template v-else>{{ memoryStoragePath }}</template>
                  </span>
                </div>
              </div>

              <div class="storage-actions-row">
                <button
                  class="btn btn--secondary memory-folder-button"
                  @click="openMemoryFolderBrowser"
                  :disabled="memoryStorageStatus !== 'ready' || isSavingMemoryPath"
                >
                  <Folder :size="14" />
                  <span>{{ memoryStorageIsCustom ? 'Ganti Folder' : 'Pilih Folder' }}</span>
                </button>
              </div>

              <details class="memory-path-manual">
                <summary>Atau ketik path folder secara manual</summary>
                <div class="memory-path-input-row">
                  <input
                    v-model="memoryStoragePathInput"
                    type="text"
                    class="form-input form-input--compact"
                    placeholder="Contoh: D:\ai-memory atau /mnt/flashdisk/ai-memory"
                    :disabled="memoryStorageStatus !== 'ready' || isSavingMemoryPath"
                  />
                  <button
                    class="btn btn--secondary btn--compact memory-path-apply-btn"
                    @click="applyMemoryStoragePath()"
                    :disabled="memoryStorageStatus !== 'ready' || isSavingMemoryPath"
                  >
                    <Save :size="13" />
                    <span>Terapkan</span>
                  </button>
                </div>
              </details>

              <button
                v-if="memoryStorageIsCustom"
                class="btn-link-reset"
                @click="resetMemoryStoragePathToDefault"
                :disabled="isSavingMemoryPath"
                type="button"
              >
                Kembalikan ke lokasi default ({{ memoryStorageDefaultPath }})
              </button>
            </div>

            <ServerFolderBrowser
              v-if="showMemoryFolderBrowser"
              :initial-path="memoryStoragePath"
              @select="handleMemoryFolderSelected"
              @close="showMemoryFolderBrowser = false"
            />

            <!-- Export / Import Buttons
            <div class="export-import-grid">
              <div class="backup-card glass">
                <Download :size="18" class="backup-icon" />
                <div class="backup-info">
                  <span class="backup-title">Export Riwayat Chat</span>
                  <span class="backup-desc">Unduh seluruh percakapan dan folder dalam format file .json</span>
                </div>
                <button class="btn btn--secondary btn--compact" @click="exportJsonFile">
                  Unduh .json
                </button>
              </div>

              
              <div class="backup-card glass">
                <Upload :size="18" class="backup-icon" />
                <div class="backup-info">
                  <span class="backup-title">Import Riwayat Chat</span>
                  <span class="backup-desc">Pulihkan percakapan dari file cadangan .json di Flashdisk / Laptop</span>
                </div>
                <label class="btn btn--secondary btn--compact file-input-label">
                  Pilih File
                  <input type="file" accept=".json" class="file-hidden-input" @change="handleFileInput" />
                </label>
              </div>
            </div> -->
          </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <button class="btn btn--secondary" @click="resetDefaults" id="reset-settings-btn">
            <RotateCcw :size="14" />
            Reset Default
          </button>
          <button class="btn btn--primary" @click="saveSettings" id="save-settings-btn">
            <Save :size="14" />
            Simpan Perubahan
          </button>
        </div>

        <Transition name="modal-backdrop">
          <div v-if="showCustomThemePopup" class="custom-theme-backdrop" @click.self="showCustomThemePopup = false">
            <div class="custom-theme-popup glass" role="dialog" aria-modal="true" aria-labelledby="custom-theme-title">
              <div class="custom-theme-popup__header">
                <div>
                  <h3 id="custom-theme-title">Custom Theme</h3>
                  <p>Pilih tiga warna utama untuk tampilan aplikasi.</p>
                </div>
                <button class="close-btn" @click="showCustomThemePopup = false" title="Tutup">
                  <X :size="18" />
                </button>
              </div>
              <div class="custom-color-grid">
                <label class="custom-color-control">
                  <span>Background</span>
                  <input :value="customTheme.background" type="color" @input="updateCustomColor('background', $event.target.value)" />
                  <code>{{ customTheme.background }}</code>
                </label>
                <label class="custom-color-control">
                  <span>Accent</span>
                  <input :value="customTheme.accent" type="color" @input="updateCustomColor('accent', $event.target.value)" />
                  <code>{{ customTheme.accent }}</code>
                </label>
                <label class="custom-color-control">
                  <span>Text</span>
                  <input :value="customTheme.text" type="color" @input="updateCustomColor('text', $event.target.value)" />
                  <code>{{ customTheme.text }}</code>
                </label>
              </div>
              <button class="btn btn--primary custom-theme-popup__done" @click="showCustomThemePopup = false">
                <Check :size="14" />
                Selesai
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.settings-modal {
  width: 720px;
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
  from {
    opacity: 0;
    transform: scale(0.96) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px 14px;
  border-bottom: 1px solid var(--color-border);
}

.modal-header-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.modal-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
}

.modal-subtitle {
  font-size: 0.73rem;
  color: var(--color-text-muted);
}

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

.close-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

/* Settings Tabs */
.settings-tabs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  padding: 8px 18px 0;
  gap: 6px;
  background: var(--color-bg-primary);
  border-bottom: 1px solid var(--color-border);
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 13px;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.78rem;
  font-weight: 500;
  font-family: var(--font-sans);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.tab-btn:hover {
  color: var(--color-text-primary);
}

.tab-btn--active {
  color: var(--color-text-accent);
  border-bottom-color: var(--color-accent);
  background: var(--color-accent-subtle);
  border-radius: 6px 6px 0 0;
}

/* Modal Toast */
.modal-toast-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 20px 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--color-accent-subtle);
  border: 1px solid var(--color-accent);
  color: var(--color-text-accent);
  font-size: 0.78rem;
}

/* Modal Body */
.modal-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
}

.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section-title-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-title {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.section-desc {
  font-size: 0.74rem;
  color: var(--color-text-muted);
}

/* Engine Cards Switcher */
.engine-cards-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.engine-card {
  padding: 14px;
  border-radius: 12px;
  background: var(--color-bg-tertiary);
  border: 1.5px solid var(--color-border);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
}

.engine-card:hover {
  border-color: var(--color-border-light);
  transform: translateY(-1px);
}

.engine-card--active {
  border-color: var(--color-accent) !important;
  background: color-mix(in srgb, var(--color-accent) 32%, var(--color-bg-tertiary)) !important;
  box-shadow: 0 0 0 1px var(--color-accent), 0 0 22px var(--color-accent-glow);
  transform: translateY(-2px);
}

.engine-card--active::before {
  content: '';
  position: absolute;
  inset: 8px auto 8px 0;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--color-accent);
  box-shadow: 0 0 12px var(--color-accent-glow);
}

.engine-card--active .engine-icon-wrapper {
  background: var(--color-accent);
  color: var(--color-on-accent, white);
  border-color: var(--color-accent);
}

.engine-card-top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.engine-icon-wrapper {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--color-bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-accent);
  border: 1px solid var(--color-border);
}

.engine-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.engine-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.engine-name {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.engine-badge {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 10px;
}

.engine-badge--active {
  background: var(--color-accent);
  color: var(--color-on-accent, white);
}

.engine-role {
  font-size: 0.7rem;
  color: var(--color-text-muted);
}

/* Ping bar */
.engine-ping-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  background: var(--color-bg-primary);
  border-radius: 6px;
  border: 1px solid var(--color-border);
}

.ping-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ping-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-text-muted);
}

.ping-dot--online {
  background: var(--color-success);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
}

.ping-dot--offline {
  background: var(--color-danger);
}

.ping-dot--loading {
  background: #f59e0b;
  animation: pulse 1s infinite;
}

.ping-text {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
}

.btn-ping {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  font-size: 0.68rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-ping:hover:not(:disabled) {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.btn-ping:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  100% {
    transform: rotate(360deg);
  }
}

.engine-input-group {
  gap: 4px;
  margin: 0;
}

.form-label-micro {
  font-size: 0.68rem;
  color: var(--color-text-muted);
}

/* Auto-Fallback Toggle Box */
.setting-toggle-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  padding-right: 14px;
}

.toggle-title-row {
  display: flex;
  align-items: center;
  gap: 7px;
}

.toggle-icon {
  color: var(--color-accent);
}

.toggle-title {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.toggle-desc {
  font-size: 0.72rem;
  color: var(--color-text-muted);
  line-height: 1.4;
}

/* Switch styling */
.switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-bg-hover);
  transition: 0.25s;
  border: 1px solid var(--color-border);
}

.slider:before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.25s;
}

input:checked + .slider {
  background-color: var(--color-accent);
}

input:checked + .slider:before {
  transform: translateX(18px);
}

.slider.round {
  border-radius: 22px;
}

.slider.round:before {
  border-radius: 50%;
}

/* Form groups & Labels */
.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label-with-badge {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.form-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.chip-info {
  font-size: 0.68rem;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
}

.chip-info--highlight {
  background: var(--color-accent-subtle);
  color: var(--color-text-accent);
  border-color: var(--color-accent);
}

.form-hint {
  font-size: 0.72rem;
  color: var(--color-text-muted);
  margin: 0;
  line-height: 1.4;
}

.context-window-card {
  padding: 16px;
  border: 1px solid var(--color-accent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-accent) 10%, var(--color-bg-secondary));
  box-shadow: 0 8px 22px color-mix(in srgb, var(--color-accent) 12%, transparent);
}

.context-window-card .form-label,
.context-window-card .active-gpu-label,
.context-window-card .form-hint {
  color: var(--color-on-bg, var(--color-text-primary));
}

.context-window-card .active-gpu-label {
  font-weight: 700;
}

.context-window-card .chip-info {
  background: var(--color-bg-tertiary);
  color: var(--color-on-bg, var(--color-text-primary));
  border-color: var(--color-accent);
}

.form-input {
  background: var(--color-bg-input);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 9px 12px;
  color: var(--color-text-primary);
  font-size: 0.82rem;
  outline: none;
  transition: all 0.2s ease;
  font-family: var(--font-sans);
}

.form-input--compact {
  padding: 7px 10px;
  font-size: 0.78rem;
}

.form-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-glow);
}

/* Preset Chips for Context Window */
.preset-chips-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
  margin-top: 4px;
}

.chip-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px 6px;
  border-radius: 8px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-light);
  cursor: pointer;
  transition: all 0.15s ease;
}

.chip-btn:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-light);
}

.chip-btn--active {
  background: color-mix(in srgb, var(--color-accent) 28%, var(--color-bg-tertiary)) !important;
  border-color: var(--color-accent) !important;
}

.chip-main {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-on-bg, var(--color-text-primary));
}

.chip-sub {
  font-size: 0.65rem;
  color: var(--color-on-bg, var(--color-text-secondary));
}

.chip-btn--active .chip-main {
  color: var(--color-on-bg, var(--color-text-primary));
}

.chip-sub--star {
  color: var(--color-on-bg, var(--color-text-primary)) !important;
  font-weight: 600;
}

.active-gpu-label {
  font-weight: 600;
  color: var(--color-accent);
}

/* Active Engine Info Bar in AI Tab (No Switch Button) */
.active-engine-badge-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-accent) 18%, var(--color-bg-tertiary));
  font-size: 0.76rem;
  margin-bottom: 14px;
}

.badge-bar--laptop {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 28%, var(--color-bg-tertiary));
  color: var(--color-on-bg, var(--color-text-primary));
}

.badge-bar--laptop strong {
  color: var(--color-on-bg, var(--color-text-primary));
}

.badge-bar--pc {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 28%, var(--color-bg-tertiary));
  color: var(--color-on-bg, var(--color-text-primary));
}

.badge-bar--pc strong {
  color: var(--color-on-bg, var(--color-text-primary));
}

.badge-bar-text {
  color: var(--color-on-bg, var(--color-text-primary));
}

/* Model Auto: task -> model mapping */
.model-map-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.model-map-header .form-hint {
  flex: 1;
  margin: 0;
}

.model-map-default-btn {
  flex-shrink: 0;
  width: auto !important;
  white-space: nowrap;
}

.model-map-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-map-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
}

.model-map-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.model-map-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.model-map-desc {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  line-height: 1.35;
}

.model-map-select {
  flex-shrink: 0;
  min-width: 180px;
  max-width: 220px;
}

/* VRAM Estimate Status Box */
.vram-estimate-box {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: all 0.2s ease;
}

.vram-estimate-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.vram-estimate-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.76rem;
  color: var(--color-text-primary);
}

.vram-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.vram-usage-badge {
  font-size: 0.7rem;
  font-weight: 700;
  font-family: var(--font-mono);
  padding: 2px 7px;
  border-radius: 6px;
}

.vram-estimate-desc {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  line-height: 1.35;
}

/* VRAM Status Colors */
.vram--safe {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 24%, var(--color-bg-tertiary));
}
.vram--safe .vram-dot {
  background: var(--color-accent);
  box-shadow: 0 0 6px var(--color-accent-glow);
}
.vram--safe .vram-usage-badge {
  background: var(--color-accent);
  color: var(--color-on-accent, white);
}

.vram--optimal {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 24%, var(--color-bg-tertiary));
}
.vram--optimal .vram-dot {
  background: var(--color-accent);
  box-shadow: 0 0 6px var(--color-accent-glow);
}
.vram--optimal .vram-usage-badge {
  background: var(--color-accent);
  color: var(--color-on-accent, white);
}

.vram--good {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 24%, var(--color-bg-tertiary));
}
.vram--good .vram-dot {
  background: var(--color-accent);
  box-shadow: 0 0 6px var(--color-accent-glow);
}
.vram--good .vram-usage-badge {
  background: var(--color-accent);
  color: var(--color-on-accent, white);
}

.vram--warning {
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.05);
}
.vram--warning .vram-dot {
  background: #ef4444;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.7);
}
.vram--warning .vram-usage-badge {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

/* Slider Controls */
.slider-wrapper {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.range-slider {
  width: 100%;
  accent-color: var(--color-accent);
  cursor: pointer;
}

.slider-ticks {
  display: flex;
  justify-content: space-between;
  font-size: 0.68rem;
  color: var(--color-text-muted);
  padding: 0 2px;
}

.slider-ticks span {
  cursor: pointer;
}

.slider-ticks span:hover {
  color: var(--color-text-primary);
}

.preset-buttons-row {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}

.btn-micro-preset {
  flex: 1;
  padding: 5px 8px;
  font-size: 0.72rem;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-micro-preset:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.btn-micro-preset--active {
  border-color: var(--color-accent);
  color: var(--color-on-bg, var(--color-text-primary));
  background: color-mix(in srgb, var(--color-accent) 28%, var(--color-bg-tertiary));
}

/* Theme Cards */
.themes-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.theme-card {
  display: flex;
  flex-direction: column;
  padding: 12px;
  border-radius: 12px;
  background: var(--theme-card-bg, var(--color-bg-tertiary));
  border: 1.5px solid var(--theme-card-accent, var(--color-border));
  color: var(--theme-card-text, var(--color-text-primary));
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  gap: 10px;
}

.theme-card:hover {
  border-color: var(--theme-card-accent, var(--color-border-light));
  transform: translateY(-2px);
}

.theme-card--active {
  border-color: var(--theme-card-accent, var(--color-accent)) !important;
  box-shadow: 0 0 16px color-mix(in srgb, var(--theme-card-accent, var(--color-accent)) 35%, transparent);
}

.theme-swatch-box {
  width: 100%;
  height: 60px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--theme-card-text, var(--color-text-primary)) 35%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  position: relative;
  overflow: hidden;
}

.theme-accent-pill {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.25);
}

.theme-sub-pill {
  width: 14px;
  height: 14px;
  border-radius: 50%;
}

.theme-custom-color-chip {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255, 255, 255, 0.72);
  border-radius: 6px;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.28);
}

.custom-theme-editor {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg-secondary);
}

.custom-theme-editor__header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
}

.custom-theme-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.58);
}

.custom-theme-popup {
  width: 420px;
  max-width: 100%;
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-bg-secondary);
  box-shadow: 0 20px 55px rgba(0, 0, 0, 0.55);
}

.custom-theme-popup__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}

.custom-theme-popup__header h3 {
  margin: 0 0 4px;
  color: var(--color-text-primary);
  font-size: 1rem;
}

.custom-theme-popup__header p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.custom-theme-popup__done {
  width: 100%;
  justify-content: center;
  margin-top: 22px;
}

.custom-color-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.custom-color-control {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
}

.custom-color-control input {
  width: 36px;
  height: 30px;
  padding: 2px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-input);
  cursor: pointer;
}

.custom-color-control code {
  grid-column: 1 / -1;
  color: var(--color-text-muted);
  font-size: 0.72rem;
}

.theme-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.theme-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.theme-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--theme-card-text, var(--color-text-primary));
}

.theme-check-icon {
  color: var(--theme-card-accent, var(--color-accent));
}

.theme-desc {
  font-size: 0.68rem;
  color: color-mix(in srgb, var(--theme-card-text, var(--color-text-muted)) 72%, transparent);
}

/* Storage / Memory Section */
.storage-box {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: 12px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
}

.storage-box-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.storage-icon-circle {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--color-accent-subtle);
  color: var(--color-text-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-accent-subtle);
}

.storage-header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.storage-box-title {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.storage-box-sub {
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.storage-actions-row {
  display: flex;
  gap: 8px;
}

.memory-path-manual {
  font-size: 0.74rem;
}

.memory-path-manual summary {
  cursor: pointer;
  color: var(--color-text-muted);
  user-select: none;
}

.memory-path-manual summary:hover {
  color: var(--color-text-secondary);
}

.memory-path-manual[open] summary {
  margin-bottom: 8px;
}

.memory-path-input-row {
  display: flex;
  gap: 8px;
}

.memory-path-input-row .form-input {
  flex: 1;
  min-width: 0;
}

.memory-path-apply-btn {
  flex-shrink: 0;
  width: auto !important;
  white-space: nowrap;
}

.btn-link-reset {
  align-self: flex-start;
  background: none;
  border: none;
  padding: 0;
  font-size: 0.72rem;
  color: var(--color-text-accent);
  cursor: pointer;
  text-decoration: underline;
}

.btn-link-reset:hover {
  color: var(--color-accent-hover);
}

.btn-link-reset:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.memory-folder-button {
  position: relative;
  overflow: hidden;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 1px var(--color-accent-subtle);
  transition: transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
}

.memory-folder-button::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(110deg, transparent 25%, var(--color-accent-subtle) 50%, transparent 75%);
  transform: translateX(-120%);
  transition: transform 0.45s ease;
}

.memory-folder-button:hover {
  transform: translateY(-2px);
  background: color-mix(in srgb, var(--color-accent) 28%, var(--color-bg-hover));
  border-color: var(--color-accent);
  box-shadow: 0 5px 16px var(--color-accent-glow);
}

.memory-folder-button:hover::after {
  transform: translateX(120%);
}

.memory-folder-button:active {
  transform: translateY(0) scale(0.97);
  box-shadow: 0 1px 5px var(--color-accent-glow);
}

.memory-folder-button:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 3px;
}

.export-import-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.backup-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 12px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
}

.backup-icon {
  color: var(--color-text-accent);
}

.backup-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.backup-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.backup-desc {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  line-height: 1.35;
}

.file-input-label {
  position: relative;
  overflow: hidden;
  justify-content: center;
}

.file-hidden-input {
  position: absolute;
  top: 0;
  left: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
}

/* Footer */
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-primary);
}

.btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: var(--font-sans);
}

.btn--compact {
  padding: 6px 12px;
  font-size: 0.78rem;
  width: 100%;
  justify-content: center;
}

.btn--secondary {
  background: var(--color-bg-hover);
  border: 1px solid var(--color-accent-subtle);
  color: var(--color-text-primary);
}

.btn--secondary:hover {
  background: color-mix(in srgb, var(--color-accent) 22%, var(--color-bg-hover));
  color: var(--color-text-primary);
  border-color: var(--color-accent);
}

.btn--primary {
  background: var(--color-accent);
  color: var(--color-on-accent, white);
}

.btn--primary:hover {
  background: var(--color-accent-hover);
  box-shadow: 0 0 16px var(--color-accent-glow);
}
</style>
