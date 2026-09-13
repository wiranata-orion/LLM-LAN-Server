<script setup>
import { ref, onMounted } from 'vue'
import { X, Folder, ChevronRight, Home, HardDrive, RefreshCw, AlertCircle, Check, ClipboardPaste, CornerDownLeft } from 'lucide-vue-next'
import { browseServerFolder } from '../services/api.ts'

const props = defineProps({
  initialPath: {
    type: String,
    default: '',
  },
  // Overridable so the same picker can be reused for other folders
  // (Vibe Coding's project folder), not just the memory location.
  title: {
    type: String,
    default: 'Pilih Folder Penyimpanan Ingatan',
  },
})

const emit = defineEmits(['select', 'close'])

const currentPath = ref(null) // null = showing top-level roots (drives)
const parentPath = ref(null)
const directories = ref([])
const shortcuts = ref([])
const isLoading = ref(true)
const errorMessage = ref('')

// The address bar. Kept separate from `currentPath` so a half-typed path is
// never mistaken for where the browser actually is: clicking through folders
// overwrites it, but whatever is typed here only takes effect on submit.
const pathInput = ref('')
const pathInputRef = ref(null)

async function loadPath(path) {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const result = await browseServerFolder(path || undefined)
    currentPath.value = result.currentPath
    parentPath.value = result.parentPath
    directories.value = result.directories
    shortcuts.value = result.shortcuts
    pathInput.value = result.currentPath || ''
    return true
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Gagal membuka folder.'
    return false
  } finally {
    isLoading.value = false
  }
}

function goUp() {
  loadPath(parentPath.value)
}

function goToRoots() {
  loadPath(null)
}

function openDirectory(entry) {
  loadPath(entry.path)
}

/** Enter (or the arrow button) in the address bar: jump straight to that folder. */
function submitPath() {
  const typed = pathInput.value.trim()
  if (!typed) {
    goToRoots()
    return
  }
  // The server does the real cleanup (quotes from "Copy as path", file://
  // URLs, trailing separators) and answers with the folder it settled on.
  loadPath(typed)
}

async function confirmSelection() {
  const typed = pathInput.value.trim()

  // Someone who pastes a path and clicks "Pilih Folder Ini" without pressing
  // Enter first still means that path - so navigate there before selecting,
  // which also validates it exists.
  if (typed && typed !== currentPath.value) {
    const ok = await loadPath(typed)
    if (!ok) return
  }

  if (!currentPath.value) return
  emit('select', currentPath.value)
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text?.trim()) return
    pathInput.value = text.trim()
    submitPath()
  } catch {
    // Clipboard permission denied (or an insecure origin) - the field can
    // still be pasted into with Ctrl+V, so just focus it.
    pathInputRef.value?.focus()
  }
}

onMounted(() => {
  loadPath(props.initialPath || null)
})
</script>

<template>
  <div class="folder-browser-backdrop" @click.self="$emit('close')">
    <div class="folder-browser glass" role="dialog" aria-modal="true" aria-labelledby="folder-browser-title">
      <div class="folder-browser-header">
        <h3 id="folder-browser-title">{{ title }}</h3>
        <button class="close-btn" @click="$emit('close')" title="Tutup">
          <X :size="18" />
        </button>
      </div>

      <!-- Shortcuts -->
      <div class="folder-browser-shortcuts">
        <button class="shortcut-btn" @click="goToRoots" title="Semua drive">
          <HardDrive :size="13" />
          <span>Drive</span>
        </button>
        <button
          v-for="shortcut in shortcuts"
          :key="shortcut.path"
          class="shortcut-btn"
          @click="openDirectory(shortcut)"
          :title="shortcut.path"
        >
          <Home :size="13" />
          <span>{{ shortcut.name }}</span>
        </button>
      </div>

      <!-- Address bar: click through the list above, or just paste a path here -->
      <div class="folder-browser-path-row">
        <button class="path-up-btn" @click="goUp" :disabled="!parentPath" title="Naik satu level">
          <ChevronRight :size="14" class="path-up-icon" />
        </button>
        <input
          ref="pathInputRef"
          v-model="pathInput"
          class="path-input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder="Tempel path di sini, lalu Enter (mis. D:\projects\app)"
          :title="pathInput || 'Ketik atau tempel path folder'"
          @keydown.enter.prevent="submitPath"
          @keydown.esc.stop="pathInput = currentPath || ''"
        />
        <button class="path-paste-btn" @click="pasteFromClipboard" title="Tempel dari clipboard lalu buka">
          <ClipboardPaste :size="14" />
        </button>
        <button class="path-go-btn" @click="submitPath" title="Buka path ini (Enter)">
          <CornerDownLeft :size="14" />
        </button>
      </div>

      <!-- Directory listing -->
      <div class="folder-browser-list">
        <div v-if="isLoading" class="folder-browser-status">
          <RefreshCw :size="16" class="spinning" />
          <span>Memuat...</span>
        </div>
        <div v-else-if="errorMessage" class="folder-browser-status folder-browser-status--error">
          <AlertCircle :size="16" />
          <span>{{ errorMessage }}</span>
        </div>
        <div v-else-if="directories.length === 0" class="folder-browser-status">
          <span>Tidak ada subfolder di sini.</span>
        </div>
        <button
          v-else
          v-for="dir in directories"
          :key="dir.path"
          class="folder-entry"
          @click="openDirectory(dir)"
          :title="dir.path"
        >
          <Folder :size="15" class="folder-entry-icon" />
          <span class="folder-entry-name">{{ dir.name }}</span>
          <ChevronRight :size="14" class="folder-entry-chevron" />
        </button>
      </div>

      <!-- Footer -->
      <div class="folder-browser-footer">
        <button class="btn btn--secondary" @click="$emit('close')">Batal</button>
        <button class="btn btn--primary" @click="confirmSelection" :disabled="!currentPath">
          <Check :size="14" />
          <span>Pilih Folder Ini</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.folder-browser-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 16px;
}

.folder-browser {
  width: 480px;
  max-width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
  animation: modalIn 0.2s ease;
}

@keyframes modalIn {
  from { opacity: 0; transform: scale(0.97) translateY(8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.folder-browser-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--color-border);
}

.folder-browser-header h3 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-text-primary);
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
}

.close-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.folder-browser-shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px 18px 0;
}

.shortcut-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  font-size: 0.74rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.shortcut-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  border-color: var(--color-border-light);
}

.folder-browser-path-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 18px 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
}

.path-up-btn {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  border-radius: 5px;
  cursor: pointer;
}

.path-up-icon {
  transform: rotate(-90deg);
}

.path-up-btn:hover:not(:disabled) {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.path-up-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.path-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  outline: none;
  font-size: 0.78rem;
  font-family: var(--font-mono, monospace);
  color: var(--color-text-primary);
}

.path-input::placeholder {
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-size: 0.74rem;
}

.folder-browser-path-row:focus-within {
  border-color: var(--color-accent);
}

.path-paste-btn,
.path-go-btn {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.16s ease;
}

.path-paste-btn:hover,
.path-go-btn:hover {
  color: var(--color-text-accent);
  border-color: var(--color-accent);
  background: var(--color-bg-hover);
}

.folder-browser-list {
  flex: 1;
  overflow-y: auto;
  margin: 10px 18px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  min-height: 160px;
  max-height: 320px;
}

.folder-browser-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 24px 16px;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.folder-browser-status--error {
  color: var(--color-danger);
  text-align: center;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  100% { transform: rotate(360deg); }
}

.folder-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  border-bottom: 1px solid var(--color-border);
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.82rem;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.folder-entry:last-child {
  border-bottom: none;
}

.folder-entry:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.folder-entry-icon {
  color: var(--color-text-accent);
  flex-shrink: 0;
}

.folder-entry-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.folder-entry-chevron {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.folder-browser-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 18px;
  border-top: 1px solid var(--color-border);
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

.btn--secondary {
  background: var(--color-bg-hover);
  border: 1px solid var(--color-accent-subtle);
  color: var(--color-text-primary);
}

.btn--secondary:hover {
  background: color-mix(in srgb, var(--color-accent) 22%, var(--color-bg-hover));
  border-color: var(--color-accent);
}

.btn--primary {
  background: var(--color-accent);
  color: var(--color-on-accent, white);
}

.btn--primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
  box-shadow: 0 0 16px var(--color-accent-glow);
}

.btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 560px) {
  .folder-browser {
    width: 100%;
  }
}
</style>
