<script setup>
import { ref, onMounted } from 'vue'
import { X, Save, RotateCcw } from 'lucide-vue-next'

const emit = defineEmits(['close', 'save'])

const apiUrl = ref('http://localhost:11434')
const temperature = ref('')
const maxTokens = ref('')

const DEFAULTS = {
  apiUrl: 'http://localhost:11434',
  temperature: '',
  maxTokens: '',
}

onMounted(() => {
  loadSettings()
})

function loadSettings() {
  try {
    const saved = localStorage.getItem('llm-settings')
    if (saved) {
      const s = JSON.parse(saved)
      apiUrl.value = s.apiUrl || DEFAULTS.apiUrl
      temperature.value = s.temperature ?? DEFAULTS.temperature
      maxTokens.value = s.maxTokens ?? DEFAULTS.maxTokens
    }
  } catch (e) {
    // ignore
  }
}

function saveSettings() {
  const settings = {
    apiUrl: apiUrl.value,
    temperature: temperature.value,
    maxTokens: maxTokens.value,
  }
  localStorage.setItem('llm-settings', JSON.stringify(settings))
  emit('save', settings)
  emit('close')
}

function resetDefaults() {
  apiUrl.value = DEFAULTS.apiUrl
  temperature.value = DEFAULTS.temperature
  maxTokens.value = DEFAULTS.maxTokens
}
</script>

<template>
  <Transition name="modal-backdrop">
    <div class="modal-backdrop" @click.self="$emit('close')">
      <div class="settings-modal glass">
        <!-- Header -->
        <div class="modal-header">
          <h2 class="modal-title">Settings</h2>
          <button class="close-btn" @click="$emit('close')" id="close-settings-btn">
            <X :size="18" />
          </button>
        </div>

        <!-- Body -->
        <div class="modal-body">
          <!-- API URL -->
          <div class="form-group">
            <label for="api-url-input" class="form-label">LLM API URL</label>
            <input
              id="api-url-input"
              v-model="apiUrl"
              type="text"
              class="form-input"
              placeholder="http://localhost:11434"
            />
            <p class="form-hint">Alamat server LLM Anda</p>
          </div>

          <!-- Temperature -->
          <div class="form-group">
            <label for="temperature-input" class="form-label">Temperature</label>
            <input
              id="temperature-input"
              v-model="temperature"
              type="number"
              class="form-input"
              placeholder="0.7 (default)"
              min="0"
              max="2"
              step="0.1"
            />
            <p class="form-hint">Kreativitas respons (0 = deterministik, 2 = sangat kreatif)</p>
          </div>

          <!-- Max Tokens -->
          <div class="form-group">
            <label for="max-tokens-input" class="form-label">Max Tokens</label>
            <input
              id="max-tokens-input"
              v-model="maxTokens"
              type="number"
              class="form-input"
              placeholder="Default (unlimited)"
              min="1"
            />
            <p class="form-hint">Batas maksimum token yang dihasilkan</p>
          </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <button class="btn btn--secondary" @click="resetDefaults" id="reset-settings-btn">
            <RotateCcw :size="14" />
            Reset
          </button>
          <button class="btn btn--primary" @click="saveSettings" id="save-settings-btn">
            <Save :size="14" />
            Save
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.settings-modal {
  width: 440px;
  max-width: 92vw;
  border-radius: 16px;
  overflow: hidden;
  animation: modalIn 0.25s ease;
}

@keyframes modalIn {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(8px);
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
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-border);
}

.modal-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
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

.modal-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

.form-input {
  background: var(--color-bg-input);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 10px 14px;
  color: var(--color-text-primary);
  font-size: 0.85rem;
  outline: none;
  transition: all 0.2s ease;
  font-family: var(--font-sans);
}

.form-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-glow);
}

.form-input::placeholder {
  color: var(--color-text-muted);
}

.form-hint {
  font-size: 0.72rem;
  color: var(--color-text-muted);
  margin: 0;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px;
  border-top: 1px solid var(--color-border);
}

.btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
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
  color: var(--color-text-secondary);
}

.btn--secondary:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.btn--primary {
  background: var(--color-accent);
  color: white;
}

.btn--primary:hover {
  background: var(--color-accent-hover);
  box-shadow: 0 0 16px var(--color-accent-glow);
}
</style>
