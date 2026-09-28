<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { Bot, User, Gauge, Pencil, ChevronLeft, ChevronRight, Pin, Volume2, VolumeX } from 'lucide-vue-next'
import { isNotePinned } from '../services/pinnedNotes.js'
import { isTtsSupported, stripForSpeech, speak, stopSpeaking, speakingText } from '../services/speech.js'
import { formatDuration, perfSummary, perfTooltip, getSettings } from '../services/api.js'
import { renderMarkdown } from '../services/markdownRenderer.js'
import { parseClarificationSegments } from '../services/clarificationParser.js'
import { parseMermaidSegments } from '../services/mermaidParser.js'
import { parseFlashcardSegments } from '../services/flashcardParser.js'
import { parseMindMapSegments } from '../services/mindMapParser.js'
import { parseDecisionMatrixSegments } from '../services/decisionMatrixParser.js'
import ClarificationCard from './ClarificationCard.vue'
import MermaidDiagram from './MermaidDiagram.vue'
import FlashcardDeck from './FlashcardDeck.vue'
import MindMap from './MindMap.vue'
import DecisionMatrix from './DecisionMatrix.vue'

const props = defineProps({
  message: {
    type: Object,
    required: true,
    // { role: 'user' | 'assistant', content: string, siblingIndex?, siblingCount? }
    // siblingIndex/siblingCount are written by messageTree.js's syncActivePath()
    // whenever this message has alternate edited/regenerated versions.
  },
  isGenerating: {
    type: Boolean,
    default: false,
  },
  // Live seconds elapsed since this reply started generating; ticks while
  // isGenerating is true, from the very first moment (before any token has
  // arrived) through to the last one.
  elapsedSeconds: {
    type: Number,
    default: 0,
  },
  // The active conversation's id (see App.vue) - only used to check whether
  // THIS message is already pinned (see pinnedNotes.js's isNotePinned),
  // scoped per conversation so the exact same reply text in two different
  // chats is tracked as two separate pins.
  conversationId: {
    type: String,
    default: '',
  },
})

// 'edit' carries the new text (String); the caller (App.vue's
// handleEditMessage) turns it into a new branch and regenerates a reply.
// 'switch-branch' carries -1/+1 for the "‹ ›" sibling-version control.
// 'clarify-submit' carries a ClarificationCard's { clarificationId, answers,
// summaryText } payload - see handleClarifySubmit below.
// 'pin' carries nothing - App.vue's handlePinMessage reads the content off
// this same message via the index ChatView.vue already tracks.
const emit = defineEmits(['edit', 'switch-branch', 'clarify-submit', 'pin'])

const isUser = computed(() => props.message.role === 'user')
const isAssistant = computed(() => props.message.role === 'assistant')
const isThinking = computed(() => isAssistant.value && props.isGenerating && !props.message.content)
const elapsedLabel = computed(() => formatDuration(props.elapsedSeconds * 1000))

// ---- Inline edit (user messages only) ----
const isEditing = ref(false)
const editDraft = ref('')
const editTextareaRef = ref(null)

function startEdit() {
  if (props.isGenerating) return
  editDraft.value = props.message.content
  isEditing.value = true
  nextTick(() => editTextareaRef.value?.focus())
}

function cancelEdit() {
  isEditing.value = false
}

function submitEdit() {
  const trimmed = editDraft.value.trim()
  if (!trimmed) return
  isEditing.value = false
  emit('edit', trimmed)
}

function handleEditKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    submitEdit()
  } else if (event.key === 'Escape') {
    cancelEdit()
  }
}

// ---- Branch switcher (either role, once a sibling version exists) ----
const siblingInfo = computed(() => ({
  index: props.message.siblingIndex ?? 0,
  total: props.message.siblingCount || 1,
}))
const hasSiblings = computed(() => siblingInfo.value.total > 1)

function switchBranch(delta) {
  emit('switch-branch', delta)
}
// Always-visible (unlike ChatView.vue's fuller meta row, which only shows on
// hover) - discoverability matters more here than completeness, so this is
// just the headline number with the full breakdown in the tooltip.
const perfLabel = computed(() => perfSummary(props.message.performance))
const perfLabelTitle = computed(() => perfTooltip(props.message.performance))

// ---- Interactive widgets (clarify, mermaid, flashcards/quiz, mindmap, decision matrix) ----
// v-html can't run a live component, so an assistant reply is split into
// ordered text/widget segments here - each 'text' segment still goes through
// the normal renderMarkdown() below; every other segment type mounts a real
// component instead. The parsers are chained rather than merged into one:
// each one only ever looks at the 'text' segments the previous one
// produced, so e.g. a ```mermaid block can never be misread as part of a
// ```clarify block or vice versa - fences don't nest, and each parser only
// has to know about its own tag. Recomputed on every token while streaming,
// same as renderMarkdown() already was - each parser is a single cheap pass
// with no backtracking.
const WIDGET_PARSERS = [parseClarificationSegments, parseMermaidSegments, parseFlashcardSegments, parseMindMapSegments, parseDecisionMatrixSegments]

const assistantSegments = computed(() => {
  if (!isAssistant.value) return []
  return WIDGET_PARSERS.reduce(
    (segments, parse) => segments.flatMap((segment) => (segment.type === 'text' ? parse(segment.content) : [segment])),
    [{ type: 'text', content: props.message.content }],
  )
})

/** Forwarded up as-is; App.vue's handleClarifySubmit turns summaryText into the next user message. */
function handleClarifySubmit(payload) {
  emit('clarify-submit', payload)
}

// ---- Pin / bookmark (assistant messages only - see pinnedNotes.js) ----
const isPinned = computed(() => (
  isAssistant.value && !!props.message.content && isNotePinned(props.conversationId, props.message.content)
))

function togglePin() {
  if (isPinned.value) return // unpinning happens from the Key Notes drawer, not here - avoids a second confirmation step for a destructive action
  emit('pin')
}

// ---- Text-to-speech (#1) - see services/speech.js ----
const ttsSupported = isTtsSupported()
const strippedForSpeech = computed(() => stripForSpeech(props.message.content))
// Derived from the one shared speakingText ref rather than local state - see
// speech.js for why (speechSynthesis is a single global resource).
const isSpeakingThis = computed(() => !!strippedForSpeech.value && speakingText.value === strippedForSpeech.value)

function toggleSpeak() {
  if (isSpeakingThis.value) {
    stopSpeaking()
    return
  }
  if (!strippedForSpeech.value) return
  speak(strippedForSpeech.value)
}

// Settings > Suara & Audio > "Baca Otomatis Balasan AI" - speaks a reply the
// moment it finishes streaming, without waiting for a click. Watches the
// isGenerating->false transition rather than message.content directly, so
// this only fires once per finished reply instead of on every token while
// streaming (message.content changes constantly during that).
watch(() => props.isGenerating, (generating, wasGenerating) => {
  if (generating || !wasGenerating || !isAssistant.value || !ttsSupported) return
  if (!getSettings().autoReadResponses) return
  if (strippedForSpeech.value) speak(strippedForSpeech.value)
})

</script>

<template>
  <div
    class="message-row"
    :class="{ 'message-row--user': isUser, 'message-row--assistant': isAssistant }"
  >
    <!-- Avatar -->
    <div class="message-avatar" :class="{ 'message-avatar--user': isUser }">
      <User v-if="isUser" :size="18" />
      <Bot v-else :size="18" />
    </div>

    <!-- Content -->
    <div class="message-content-wrapper">
      <div class="message-role-row">
        <span class="message-role">{{ isUser ? 'You' : 'Xufruz' }}</span>
        <span v-if="isAssistant && isGenerating" class="generation-timer" :title="'Sedang menjawab: ' + elapsedLabel">
          {{ elapsedLabel }}
        </span>
      </div>

      <div v-if="isUser && !isEditing" class="message-bubble message-bubble--user">
        <div v-if="message.images?.length" class="message-images-row">
          <img
            v-for="(image, idx) in message.images"
            :key="idx"
            :src="`data:image/jpeg;base64,${image}`"
            class="message-image-thumb"
            alt="Gambar terlampir"
          />
        </div>
        {{ message.content }}
      </div>

      <!-- Inline edit mode - replaces the plain bubble above while active. -->
      <div v-else-if="isUser && isEditing" class="message-edit-box">
        <textarea
          ref="editTextareaRef"
          v-model="editDraft"
          class="message-edit-textarea"
          rows="2"
          @keydown="handleEditKeydown"
        ></textarea>
        <div class="message-edit-actions">
          <button class="message-edit-btn message-edit-btn--cancel" type="button" @click="cancelEdit">Batal</button>
          <button
            class="message-edit-btn message-edit-btn--save"
            type="button"
            :disabled="!editDraft.trim()"
            @click="submitEdit"
          >
            Simpan &amp; Kirim Ulang
          </button>
        </div>
      </div>

      <div v-if="isThinking" class="thinking-indicator" aria-label="Thinking">
        <span>Thinking</span><span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      </div>

      <div v-else-if="isAssistant" class="message-bubble message-bubble--assistant">
        <template v-for="(segment, index) in assistantSegments" :key="index">
          <div v-if="segment.type === 'text'" class="markdown-body" v-html="renderMarkdown(segment.content)"></div>
          <ClarificationCard v-else-if="segment.type === 'clarify'" :schema="segment.schema" @submit="handleClarifySubmit" />
          <MermaidDiagram v-else-if="segment.type === 'mermaid'" :source="segment.source" />
          <FlashcardDeck v-else-if="segment.type === 'flashcards'" :schema="segment.schema" />
          <MindMap v-else-if="segment.type === 'mindmap'" :schema="segment.schema" />
          <DecisionMatrix v-else-if="segment.type === 'decision-matrix'" :schema="segment.schema" />
        </template>
      </div>

      <!-- Edit trigger (user only) + branch switcher (either role, once an
           edited/regenerated sibling version exists). -->
      <div v-if="!isEditing && (isUser || isAssistant) && (isUser || !isThinking) && (isUser || hasSiblings || message.content)" class="message-footer-row">
        <button
          v-if="isUser"
          class="message-edit-trigger"
          type="button"
          title="Edit pesan ini"
          @click="startEdit"
        >
          <Pencil :size="12" />
        </button>
        <button
          v-if="isAssistant && message.content"
          class="message-pin-trigger"
          :class="{ 'message-pin-trigger--pinned': isPinned }"
          type="button"
          :title="isPinned ? 'Sudah disematkan (lepas dari Key Notes)' : 'Sematkan ke Key Notes'"
          @click="togglePin"
        >
          <Pin :size="12" :fill="isPinned ? 'currentColor' : 'none'" />
        </button>
        <button
          v-if="isAssistant && ttsSupported && message.content"
          class="message-pin-trigger"
          :class="{ 'message-pin-trigger--pinned': isSpeakingThis }"
          type="button"
          :title="isSpeakingThis ? 'Berhenti membaca' : 'Bacakan balasan ini'"
          @click="toggleSpeak"
        >
          <VolumeX v-if="isSpeakingThis" :size="12" />
          <Volume2 v-else :size="12" />
        </button>
        <div v-if="hasSiblings" class="branch-switcher" title="Versi lain dari pesan ini">
          <button class="branch-switcher-btn" type="button" title="Versi sebelumnya" @click="switchBranch(-1)">
            <ChevronLeft :size="12" />
          </button>
          <span class="branch-switcher-label">{{ siblingInfo.index + 1 }}/{{ siblingInfo.total }}</span>
          <button class="branch-switcher-btn" type="button" title="Versi selanjutnya" @click="switchBranch(1)">
            <ChevronRight :size="12" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.message-row {
  display: flex;
  gap: 12px;
  padding: 20px 24px;
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
  animation: fadeSlideIn 0.3s ease;
}

/* Separator line only after assistant (AI) messages */
.message-row--assistant {
  border-bottom: 1px solid var(--color-border);
}

.message-row--assistant:last-child {
  border-bottom: none;
}

/* User messages sit on the right (avatar follows to the right of the
   bubble), AI replies stay on the left - the usual messaging-app layout. */
.message-row--user {
  flex-direction: row-reverse;
}

.message-row--user .message-content-wrapper {
  align-items: flex-end;
}

.message-row--user .message-role-row {
  flex-direction: row-reverse;
}

.message-row--user .message-bubble--user {
  text-align: right;
}

.message-row--user .message-images-row {
  justify-content: flex-end;
}

@keyframes fadeSlideIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-tertiary);
  color: var(--color-text-accent);
  border: 1px solid var(--color-border);
  margin-top: 4px;
}

.message-avatar--user {
  background: var(--color-accent);
  color: var(--color-on-accent, white);
  border-color: var(--color-accent);
}

.message-content-wrapper {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.message-role-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.message-role {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.generation-timer {
  font-size: 0.72rem;
  font-family: var(--font-mono);
  color: var(--color-text-accent);
  background: var(--color-accent-subtle);
  padding: 1px 7px;
  border-radius: 8px;
  animation: timerPulse 1.6s ease-in-out infinite;
}

.perf-indicator {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.7rem;
  font-family: var(--font-mono);
  color: var(--color-text-muted);
  cursor: default;
}

@keyframes timerPulse {
  0%, 100% { opacity: 0.75; }
  50% { opacity: 1; }
}

.message-bubble {
  font-size: 0.925rem;
  line-height: 1.7;
}

.message-bubble--user {
  color: var(--color-text-primary);
  white-space: pre-wrap;
}

.message-images-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.message-image-thumb {
  max-width: 220px;
  max-height: 220px;
  border-radius: 10px;
  object-fit: cover;
}

.message-bubble--assistant {
  color: var(--color-ai-bubble-text);
}

/* ===== Inline message edit ===== */
.message-edit-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.message-row--user .message-edit-box {
  align-items: flex-end;
}

.message-edit-textarea {
  width: 100%;
  max-width: 480px;
  min-height: 60px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--color-accent);
  background: var(--color-bg-input, var(--color-bg-tertiary));
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: 0.925rem;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}

.message-edit-actions {
  display: flex;
  gap: 6px;
}

.message-edit-btn {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 0.75rem;
  font-family: var(--font-sans);
  cursor: pointer;
  background: none;
  color: var(--color-text-secondary);
  transition: all 0.15s ease;
}

.message-edit-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.message-edit-btn--save {
  border-color: var(--color-accent);
  color: var(--color-text-accent);
}

.message-edit-btn--save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ===== Edit trigger + branch switcher footer ===== */
.message-footer-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.message-row--user .message-footer-row {
  justify-content: flex-end;
}

.message-edit-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.message-row:hover .message-edit-trigger,
.message-row:focus-within .message-edit-trigger {
  opacity: 1;
}

.message-edit-trigger:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.message-pin-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.message-row:hover .message-pin-trigger,
.message-row:focus-within .message-pin-trigger {
  opacity: 1;
}

.message-pin-trigger:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

/* Already-pinned stays visible even without hovering, so it's obvious at a
   glance which replies were already saved to Key Notes. */
.message-pin-trigger--pinned {
  opacity: 1;
  color: #f59e0b;
}

.message-pin-trigger--pinned:hover {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.12);
}

.branch-switcher {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--color-text-muted);
}

.branch-switcher-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 4px;
  background: none;
  color: inherit;
  cursor: pointer;
}

.branch-switcher-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.branch-switcher-label {
  font-size: 0.7rem;
  font-family: var(--font-mono);
  min-width: 24px;
  text-align: center;
}

.thinking-indicator {
  display: inline-flex;
  align-items: baseline;
  color: var(--color-text-muted);
  font-size: 0.925rem;
  line-height: 1.7;
}

.thinking-dots {
  display: inline-flex;
  gap: 3px;
  margin-left: 3px;
}

.thinking-dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  animation: thinkingPulse 1.2s infinite ease-in-out;
}

.thinking-dots i:nth-child(2) {
  animation-delay: 0.15s;
}

.thinking-dots i:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes thinkingPulse {
  0%, 60%, 100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

.message-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.message-row:hover .message-actions {
  opacity: 1;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 0.75rem;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: var(--font-sans);
}

.action-btn:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-light);
  background: var(--color-bg-hover);
}

/* ===== Code block card ===== */
.code-card {
  background: var(--color-bg-secondary);
  border-radius: 8px;
  margin: 12px 0;
  overflow: hidden;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}

.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--color-bg-tertiary);
  padding: 4px 8px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.code-lang {
  font-family: var(--font-mono);
}

.copy-code-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 2px 6px;
}

.copy-code-btn:hover {
  color: var(--color-text-primary);
}

/* Syntax highlighting tokens */
.markdown-body .hljs-keyword,
.markdown-body .hljs-selector-tag,
.markdown-body .hljs-literal,
.markdown-body .hljs-type {
  color: #c084fc;
}

.markdown-body .hljs-string,
.markdown-body .hljs-title,
.markdown-body .hljs-section,
.markdown-body .hljs-attribute {
  color: #86efac;
}

.markdown-body .hljs-number,
.markdown-body .hljs-variable,
.markdown-body .hljs-template-variable {
  color: #fbbf24;
}

.markdown-body .hljs-comment,
.markdown-body .hljs-quote {
  color: #94a3b8;
  font-style: italic;
}

.markdown-body .hljs-built_in,
.markdown-body .hljs-symbol,
.markdown-body .hljs-bullet {
  color: #67e8f9;
}

/* ===== List styling (nested) ===== */
.markdown-body ol,
.markdown-body ul {
  margin: 0.4em 0;
  padding-left: 1.5em;
}

.markdown-body ol {
  list-style-type: decimal;
}

.markdown-body ul {
  list-style-type: disc;
}

.markdown-body li {
  margin: 0.2em 0;
  padding-left: 0.2em;
}

/* Nested list indentation */
.markdown-body ol ol,
.markdown-body ul ol,
.markdown-body ol ul,
.markdown-body ul ul {
  margin: 0.2em 0;
  padding-left: 1.5em;
}

.markdown-body ol ol {
  list-style-type: lower-alpha;
}

.markdown-body ol ol ol {
  list-style-type: lower-roman;
}

.markdown-body ul ul {
  list-style-type: circle;
}

.markdown-body ul ul ul {
  list-style-type: square;
}

/* ===== Math formula styling ===== */
.math-block {
  display: block;
  text-align: center;
  padding: 16px 20px;
  margin: 12px 0;
  background: var(--color-bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--color-border);
  font-size: 1.1em;
  font-family: 'Cambria Math', 'Latin Modern Math', 'STIX Two Math', Georgia, serif;
  letter-spacing: 0.02em;
  overflow-x: auto;
}

.math-inline {
  font-family: 'Cambria Math', 'Latin Modern Math', 'STIX Two Math', Georgia, serif;
  font-style: italic;
  padding: 1px 4px;
  background: var(--color-accent-subtle);
  border-radius: 4px;
  font-size: 0.95em;
}

.math-frac {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  vertical-align: middle;
  margin: 0 4px;
}

.math-num {
  border-bottom: 1.5px solid currentColor;
  padding: 0 4px 2px;
  line-height: 1.3;
}

.math-den {
  padding: 2px 4px 0;
  line-height: 1.3;
}

.math-text {
  font-style: normal;
  font-family: var(--font-sans);
}

/* ===== Table styling ===== */
.markdown-body table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
  font-size: 0.88rem;
}

.markdown-body th,
.markdown-body td {
  border: 1px solid var(--color-border);
  padding: 8px 12px;
  text-align: left;
}

.markdown-body th {
  background: var(--color-bg-tertiary);
  font-weight: 600;
  color: var(--color-text-primary);
}

.markdown-body td {
  color: var(--color-text-secondary);
}

.markdown-body tr:hover td {
  background: var(--color-bg-hover);
}

/* ===== Blockquote styling ===== */
.markdown-body blockquote {
  border-left: 3px solid var(--color-accent);
  margin: 8px 0;
  padding: 4px 16px;
  color: var(--color-text-secondary);
  background: var(--color-accent-subtle);
  border-radius: 0 6px 6px 0;
}

/* ===== Heading styling ===== */
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4 {
  margin: 16px 0 8px;
  color: var(--color-text-primary);
  line-height: 1.4;
}

.markdown-body h1 { font-size: 1.4em; }
.markdown-body h2 { font-size: 1.2em; }
.markdown-body h3 { font-size: 1.05em; }
.markdown-body h4 { font-size: 0.95em; }

/* ===== Inline code ===== */
.markdown-body code {
  background: var(--color-bg-tertiary);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.88em;
}

/* ===== Horizontal rule ===== */
.markdown-body hr {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 16px 0;
}

/* ===== Links ===== */
.markdown-body a {
  color: var(--color-accent);
  text-decoration: none;
}

.markdown-body a:hover {
  text-decoration: underline;
}

/* ===== Strikethrough ===== */
.markdown-body del,
.markdown-body s {
  opacity: 0.6;
}

/* ===== Paragraphs ===== */
.markdown-body p {
  margin: 0.5em 0;
  text-align: justify;
  text-justify: inter-word;
  hyphens: auto;
}

/* Justifying short lines (headings, list items, table cells, code) looks
   broken rather than tidy, so it's scoped to prose paragraphs only. */
.markdown-body blockquote p {
  text-align: justify;
}
</style>

