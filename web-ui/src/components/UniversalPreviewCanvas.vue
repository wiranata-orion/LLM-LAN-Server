<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Monitor, Smartphone, Tablet, RotateCw, Terminal, AlertTriangle, ChevronDown, ChevronUp, Trash2 } from 'lucide-vue-next'
import { buildPreviewDocument } from '../services/previewBundler.js'
import { getSettings } from '../services/api.js'

const props = defineProps({
  code: { type: String, required: true },
  /** 'html' | 'vue' | 'react' - see WorkspaceCodeBlock.vue's previewKind. */
  kind: { type: String, required: true },
  typescript: { type: Boolean, default: false },
})

const DEVICE_SIZES = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
}

const device = ref(getSettings().defaultPreviewDevice || 'desktop')
const reloadKey = ref(0)
const logs = ref([])
const consoleOpen = ref(false)
const stageEl = ref(null)
const iframeEl = ref(null)
const scale = ref(1)

const previewResult = computed(() => buildPreviewDocument({ kind: props.kind, code: props.code, typescript: props.typescript }))

const errorCount = computed(() => logs.value.filter((entry) => entry.level === 'error').length)

// Fixed-size phone/tablet mockups are wider than the chat column they live
// in, so - rather than letting them overflow or forcing a narrower fake
// device - the frame is measured against its container and scaled down to
// fit, same idea as a responsive design tool's device preview.
function updateScale() {
  const size = DEVICE_SIZES[device.value]
  if (!size || !stageEl.value) {
    scale.value = 1
    return
  }
  const available = stageEl.value.clientWidth - 16
  scale.value = Math.min(1, available / size.width)
}

let resizeObserver = null

function handleMessage(event) {
  if (!event.data || event.data.source !== 'xufruz-preview') return
  if (iframeEl.value && event.source !== iframeEl.value.contentWindow) return
  if (event.data.type === 'console') {
    logs.value.push({ level: event.data.level, message: event.data.message })
  } else if (event.data.type === 'error') {
    logs.value.push({ level: 'error', message: event.data.stack ? `${event.data.message}\n${event.data.stack}` : event.data.message })
    consoleOpen.value = true
  }
  if (logs.value.length > 300) logs.value.splice(0, logs.value.length - 300)
}

onMounted(() => {
  window.addEventListener('message', handleMessage)
  resizeObserver = new ResizeObserver(updateScale)
  if (stageEl.value) resizeObserver.observe(stageEl.value)
  updateScale()
})

onUnmounted(() => {
  window.removeEventListener('message', handleMessage)
  resizeObserver?.disconnect()
})

watch(device, updateScale)
watch(() => [props.code, props.kind, props.typescript], () => {
  logs.value = []
})

function reload() {
  logs.value = []
  reloadKey.value += 1
}

const deviceFrameStyle = computed(() => {
  const size = DEVICE_SIZES[device.value]
  if (!size) return {}
  return {
    width: `${size.width}px`,
    height: `${size.height}px`,
    transform: `scale(${scale.value})`,
  }
})

const stageHeightStyle = computed(() => {
  const size = DEVICE_SIZES[device.value]
  if (!size) return {}
  return { height: `${Math.round(size.height * scale.value)}px` }
})
</script>

<template>
  <div class="preview-canvas">
    <div class="canvas-toolbar">
      <div class="device-switch">
        <button class="device-btn" :class="{ 'device-btn--active': device === 'desktop' }" title="Desktop" @click="device = 'desktop'">
          <Monitor :size="13" />
        </button>
        <button class="device-btn" :class="{ 'device-btn--active': device === 'tablet' }" title="Tablet" @click="device = 'tablet'">
          <Tablet :size="13" />
        </button>
        <button class="device-btn" :class="{ 'device-btn--active': device === 'mobile' }" title="Mobile" @click="device = 'mobile'">
          <Smartphone :size="13" />
        </button>
      </div>
      <div class="canvas-toolbar-right">
        <button class="canvas-icon-btn" title="Muat ulang pratinjau" @click="reload">
          <RotateCw :size="12" />
        </button>
        <button class="canvas-icon-btn canvas-console-toggle" :class="{ 'canvas-icon-btn--active': consoleOpen }" title="Console" @click="consoleOpen = !consoleOpen">
          <Terminal :size="12" />
          <span v-if="logs.length" class="console-badge" :class="{ 'console-badge--error': errorCount }">{{ logs.length }}</span>
          <ChevronUp v-if="consoleOpen" :size="11" />
          <ChevronDown v-else :size="11" />
        </button>
      </div>
    </div>

    <div v-if="!previewResult.ok" class="canvas-error">
      <AlertTriangle :size="14" />
      <span>{{ previewResult.error }}</span>
    </div>

    <template v-else>
      <div ref="stageEl" class="canvas-stage" :class="{ 'canvas-stage--framed': device !== 'desktop' }" :style="stageHeightStyle">
        <div v-if="device === 'desktop'" class="device-shell device-shell--desktop">
          <iframe
            :key="reloadKey"
            ref="iframeEl"
            class="device-screen"
            :srcdoc="previewResult.srcdoc"
            sandbox="allow-scripts"
            title="Universal Preview"
          ></iframe>
        </div>
        <div v-else class="device-shell" :class="`device-shell--${device}`" :style="deviceFrameStyle">
          <div v-if="device === 'mobile'" class="device-notch"></div>
          <div v-else class="device-camera-dot"></div>
          <iframe
            :key="reloadKey"
            ref="iframeEl"
            class="device-screen"
            :srcdoc="previewResult.srcdoc"
            sandbox="allow-scripts"
            title="Universal Preview"
          ></iframe>
        </div>
      </div>

      <div v-if="consoleOpen" class="canvas-console">
        <div v-if="!logs.length" class="canvas-console-empty">
          <Terminal :size="12" />
          <span>Belum ada output console.</span>
        </div>
        <div v-for="(entry, index) in logs" :key="index" class="canvas-console-line" :class="`canvas-console-line--${entry.level}`">
          {{ entry.message }}
        </div>
        <button v-if="logs.length" class="canvas-console-clear" title="Bersihkan console" @click="logs = []">
          <Trash2 :size="11" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.preview-canvas {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  overflow: hidden;
}

.canvas-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
}

.device-switch {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 6px;
  background: var(--color-bg-input);
}

.device-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 7px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
}

.device-btn--active {
  background: var(--color-accent-subtle);
  color: var(--color-text-accent);
}

.canvas-toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.canvas-icon-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-input);
  color: var(--color-text-muted);
  font-size: 0.66rem;
  cursor: pointer;
}

.canvas-icon-btn--active {
  color: var(--color-text-accent);
  border-color: rgba(139, 92, 246, 0.45);
}

.console-badge {
  padding: 0 4px;
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  font-size: 0.6rem;
  font-weight: 700;
}

.console-badge--error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-danger, #ef4444);
}

.canvas-error {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 12px;
  color: var(--color-danger, #ef4444);
  font-size: 0.76rem;
  font-family: var(--font-mono);
  white-space: pre-wrap;
}

.canvas-stage {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-x: auto;
  background: var(--color-bg-secondary);
  padding: 0;
}

.canvas-stage--framed {
  padding: 12px 8px;
}

.device-shell {
  position: relative;
  flex-shrink: 0;
}

.device-shell--desktop {
  width: 100%;
}

.device-shell--desktop .device-screen {
  width: 100%;
  min-height: 360px;
  border: none;
  background: white;
  display: block;
}

.device-shell--mobile,
.device-shell--tablet {
  transform-origin: top center;
  box-sizing: border-box;
  background: #111318;
  border-radius: 34px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.device-shell--mobile {
  padding: 16px 9px;
}

.device-shell--tablet {
  padding: 22px 18px;
  border-radius: 22px;
}

.device-shell--mobile .device-screen,
.device-shell--tablet .device-screen {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 18px;
  background: white;
  display: block;
}

.device-notch {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  width: 90px;
  height: 18px;
  border-radius: 10px;
  background: #111318;
  z-index: 1;
}

.device-camera-dot {
  position: absolute;
  top: 9px;
  left: 50%;
  transform: translateX(-50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #3a3d45;
  z-index: 1;
}

.canvas-console {
  padding: 8px 10px;
  border-top: 1px solid var(--color-border);
  font-family: var(--font-mono);
  font-size: 0.74rem;
  line-height: 1.5;
  max-height: 200px;
  overflow-y: auto;
  position: relative;
}

.canvas-console-empty {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--color-text-muted);
}

.canvas-console-line {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-text-secondary);
  padding: 1px 0;
}

.canvas-console-line--warn {
  color: #f59e0b;
}

.canvas-console-line--error {
  color: var(--color-danger, #ef4444);
}

.canvas-console-clear {
  position: sticky;
  bottom: 0;
  float: right;
  display: flex;
  align-items: center;
  padding: 3px 6px;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-bg-input);
  color: var(--color-text-muted);
  cursor: pointer;
}
</style>
