<script setup>
import { nextTick, ref, watch } from 'vue'
import mermaid from 'mermaid'
import { ZoomIn, ZoomOut, Maximize2, Download, Image as ImageIcon, AlertTriangle } from 'lucide-vue-next'

const props = defineProps({
  // Raw mermaid diagram definition (the fenced block's content) - see
  // mermaidParser.js. Only ever handed a *closed* fence's content; a
  // still-streaming block is kept as plain text upstream until then.
  source: {
    type: String,
    required: true,
  },
})

// mermaid.initialize() is global and only needs to run once per page, not
// once per diagram - a module-level flag rather than component state.
let initialized = false
function ensureInitialized() {
  if (initialized) return
  mermaid.initialize({
    startOnLoad: false,
    // The diagram text ultimately comes from model output - treat it as
    // untrusted, same stance as MessageBubble.vue's markdown-it config
    // (html:false): 'strict' escapes label content and disables click/script
    // bindings instead of trusting whatever the model (or a prompt-injected
    // RAG document) wrote into a node label.
    securityLevel: 'strict',
    theme: 'dark',
  })
  initialized = true
}

const svgMarkup = ref('')
const renderError = ref('')
const containerRef = ref(null)
let bindFunctions = null
// Each diagram needs a unique id - mermaid uses it as the temporary SVG
// element's id while rendering, and collisions between two diagrams in the
// same reply would corrupt both.
const diagramId = `mermaid-${Math.random().toString(36).slice(2, 10)}`

async function renderDiagram() {
  ensureInitialized()
  renderError.value = ''
  try {
    const result = await mermaid.render(diagramId, props.source)
    svgMarkup.value = result.svg
    bindFunctions = result.bindFunctions ?? null
    await nextTick()
    // Wires up whatever interactive bits the diagram itself defines (mostly
    // a no-op under securityLevel: 'strict', but this is the documented
    // contract - see mermaid.d.ts - so it's called for correctness).
    bindFunctions?.(containerRef.value)
  } catch (error) {
    // A model can write invalid mermaid syntax same as it can write invalid
    // code - fall back to showing the raw source instead of taking the whole
    // message bubble down with a thrown error.
    svgMarkup.value = ''
    renderError.value = error instanceof Error ? error.message : 'Gagal me-render diagram'
  }
}

watch(() => props.source, renderDiagram, { immediate: true })

// ---- Zoom / pan ----
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const isPanning = ref(false)
const MIN_ZOOM = 0.4
const MAX_ZOOM = 3
const ZOOM_STEP = 0.2

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

function zoomIn() {
  zoom.value = clampZoom(zoom.value + ZOOM_STEP)
}

function zoomOut() {
  zoom.value = clampZoom(zoom.value - ZOOM_STEP)
}

function resetView() {
  zoom.value = 1
  panX.value = 0
  panY.value = 0
}

function handleWheel(event) {
  event.preventDefault()
  zoom.value = clampZoom(zoom.value + (event.deltaY > 0 ? -0.1 : 0.1))
}

// Drag-to-pan - plain pointer tracking, no library: panStart snapshots where
// the drag began and what the offset already was, so each move is just "how
// far has the pointer travelled since mousedown", not an accumulating delta
// that would drift if a mousemove event was ever missed.
let panStart = { x: 0, y: 0, originX: 0, originY: 0 }

function startPan(event) {
  isPanning.value = true
  panStart = { x: event.clientX, y: event.clientY, originX: panX.value, originY: panY.value }
}

function movePan(event) {
  if (!isPanning.value) return
  panX.value = panStart.originX + (event.clientX - panStart.x)
  panY.value = panStart.originY + (event.clientY - panStart.y)
}

function endPan() {
  isPanning.value = false
}

// ---- Export ----
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function exportSvg() {
  if (!svgMarkup.value) return
  downloadBlob(new Blob([svgMarkup.value], { type: 'image/svg+xml' }), 'diagram.svg')
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Gagal memuat SVG untuk export PNG'))
    image.src = src
  })
}

/**
 * SVG -> PNG entirely in the browser: draw the rendered SVG onto an
 * offscreen canvas at 2x its on-screen size (crisper than a 1:1 raster of
 * CSS pixels) and read it back out as a PNG blob. No server round-trip and
 * no extra dependency beyond the canvas API already used elsewhere for the
 * client-side image resizing in image.js.
 */
async function exportPng() {
  const svgEl = containerRef.value?.querySelector('svg')
  if (!svgEl || !svgMarkup.value) return

  const { width, height } = svgEl.getBoundingClientRect()
  const svgUrl = URL.createObjectURL(new Blob([svgMarkup.value], { type: 'image/svg+xml' }))
  try {
    const image = await loadImage(svgUrl)
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    // Mermaid's 'dark' theme SVG has no opaque background of its own - without
    // this the exported PNG would have a transparent background that reads as
    // black/broken in viewers that don't composite transparency (e.g. some
    // chat apps' image previews).
    ctx.fillStyle = '#1a1b26'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, 'diagram.png')
    }, 'image/png')
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}
</script>

<template>
  <div class="mermaid-widget">
    <div class="mermaid-toolbar">
      <button class="mermaid-tool-btn" type="button" title="Perbesar" @click="zoomIn">
        <ZoomIn :size="13" />
      </button>
      <button class="mermaid-tool-btn" type="button" title="Perkecil" @click="zoomOut">
        <ZoomOut :size="13" />
      </button>
      <button class="mermaid-tool-btn" type="button" title="Reset tampilan" @click="resetView">
        <Maximize2 :size="13" />
      </button>
      <span class="mermaid-toolbar-divider"></span>
      <button class="mermaid-tool-btn" type="button" title="Export SVG" :disabled="!svgMarkup" @click="exportSvg">
        <Download :size="13" /><span>SVG</span>
      </button>
      <button class="mermaid-tool-btn" type="button" title="Export PNG" :disabled="!svgMarkup" @click="exportPng">
        <ImageIcon :size="13" /><span>PNG</span>
      </button>
    </div>

    <div
      v-if="svgMarkup"
      ref="containerRef"
      class="mermaid-viewport"
      :class="{ 'mermaid-viewport--panning': isPanning }"
      @wheel="handleWheel"
      @mousedown="startPan"
      @mousemove="movePan"
      @mouseup="endPan"
      @mouseleave="endPan"
    >
      <!-- eslint-disable-next-line vue/no-v-html -- SVG from mermaid.render() under securityLevel:'strict', not raw model text -->
      <div
        class="mermaid-canvas"
        :class="{ 'mermaid-canvas--panning': isPanning }"
        :style="{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }"
        v-html="svgMarkup"
      ></div>
    </div>

    <div v-else-if="renderError" class="mermaid-error">
      <AlertTriangle :size="13" />
      <div>
        <p class="mermaid-error-title">Gagal me-render diagram: {{ renderError }}</p>
        <pre class="mermaid-error-source">{{ source }}</pre>
      </div>
    </div>

    <div v-else class="mermaid-loading">Merender diagram...</div>
  </div>
</template>

<style scoped>
.mermaid-widget {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg-secondary);
  margin: 12px 0;
  overflow: hidden;
}

.mermaid-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background: var(--color-bg-tertiary);
  border-bottom: 1px solid var(--color-border);
}

.mermaid-toolbar-divider {
  width: 1px;
  height: 16px;
  background: var(--color-border);
  margin: 0 4px;
}

.mermaid-tool-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--color-text-muted);
  font-size: 0.7rem;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all 0.15s ease;
}

.mermaid-tool-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.mermaid-tool-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mermaid-viewport {
  overflow: hidden;
  padding: 16px;
  cursor: grab;
  min-height: 120px;
  display: flex;
  justify-content: center;
}

.mermaid-viewport--panning {
  cursor: grabbing;
}

.mermaid-canvas {
  transform-origin: center center;
  transition: transform 0.12s ease;
}

/* No transition while actively dragging - fighting a CSS transition during a
   continuous mousemove makes panning visibly lag behind the cursor. */
.mermaid-canvas--panning {
  transition: none;
}

.mermaid-canvas :deep(svg) {
  max-width: none;
  height: auto;
}

.mermaid-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
  color: var(--color-danger, #ef4444);
  font-size: 0.78rem;
}

.mermaid-error-title {
  margin: 0 0 6px;
}

.mermaid-error-source {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  white-space: pre-wrap;
  word-break: break-word;
}

.mermaid-loading {
  padding: 16px;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  text-align: center;
}
</style>
