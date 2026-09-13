<script setup>
import { ref, computed, nextTick, watch, onMounted } from 'vue'
import MarkdownIt from 'markdown-it'
import {
  Send,
  Square,
  Bot,
  User,
  FileCode,
  Search,
  Crosshair,
  AlertCircle,
  Sparkles,
  PanelRightClose,
} from 'lucide-vue-next'
import WorkspaceCodeBlock from './WorkspaceCodeBlock.vue'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  isGenerating: { type: Boolean, default: false },
  // Flat list of project paths, for the "@" autocomplete.
  files: { type: Array, default: () => [] },
  activeFilePath: { type: String, default: '' },
  applyingPath: { type: String, default: '' },
  errorMessage: { type: String, default: '' },
})

const emit = defineEmits(['send', 'stop', 'diff', 'apply', 'collapse'])

const input = ref('')
const textareaRef = ref(null)
const scrollerRef = ref(null)
const mentionMenuRef = ref(null)

// ===== Markdown for the prose between code blocks =====
// Fenced code never reaches markdown-it: it is split out first (see
// parseSegments) so it can be rendered as a real component with buttons.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false })

function renderText(text) {
  return md.render(text)
}

/**
 * Splits an assistant reply into prose and code blocks.
 *
 * Line-based rather than one big regex because replies are parsed on every
 * token while streaming: a fence that hasn't closed yet must still render as
 * code (just not an applicable one) instead of leaking raw backticks.
 */
function parseSegments(content) {
  const lines = content.split('\n')
  const segments = []
  let inCode = false
  let fenceCharacter = ''
  let fenceInfo = ''
  let buffer = []

  const flushText = () => {
    const text = buffer.join('\n')
    if (text.trim()) segments.push({ kind: 'text', content: text })
    buffer = []
  }

  const flushCode = (closed) => {
    const previousText = [...segments].reverse().find((segment) => segment.kind === 'text')
    const { language, filePath } = resolveCodeTarget(fenceInfo, buffer, previousText?.content || '')
    segments.push({ kind: 'code', language, filePath, content: buffer.join('\n'), closed })
    buffer = []
  }

  for (const line of lines) {
    if (!inCode) {
      const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (open) {
        flushText()
        inCode = true
        fenceCharacter = open[1][0]
        fenceInfo = open[2] || ''
        continue
      }
      buffer.push(line)
      continue
    }

    const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)
    if (close && close[1][0] === fenceCharacter) {
      flushCode(true)
      inCode = false
      continue
    }
    buffer.push(line)
  }

  if (inCode) flushCode(false)
  else flushText()

  return segments
}

/**
 * Works out which file a code block belongs to.
 *
 * The system prompt asks for "```ts:src/app.ts", but local models drift, so
 * three fallbacks follow - without a path the block can't be diffed or
 * applied, which is the whole point of the panel.
 */
function resolveCodeTarget(fenceInfo, codeLines, precedingText) {
  const info = (fenceInfo || '').trim()

  // 1. The documented form: ```lang:path/to/file.ts
  if (info.includes(':')) {
    const [language, ...rest] = info.split(':')
    const filePath = rest.join(':').trim()
    if (looksLikePath(filePath)) return { language: language.trim(), filePath: normalizePath(filePath) }
  }

  // 2. A bare path as the fence info: ```src/app.ts
  if (looksLikePath(info) && !info.includes(' ')) {
    return { language: extensionOf(info), filePath: normalizePath(info) }
  }

  // 3. A path in the first line of the code, as a comment.
  const firstLine = (codeLines[0] || '').trim()
  const commentPath = firstLine.match(/^(?:\/\/|#|--|<!--|\/\*)\s*([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)\s*(?:-->|\*\/)?$/)
  if (commentPath && looksLikePath(commentPath[1])) {
    return { language: info || extensionOf(commentPath[1]), filePath: normalizePath(commentPath[1]) }
  }

  // 4. A path named just above the block ("update `src/app.ts`:" / "**src/app.ts**").
  const tail = precedingText.split('\n').slice(-2).join(' ')
  const mentioned = tail.match(/[`*"']([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)[`*"']/)
  if (mentioned && looksLikePath(mentioned[1])) {
    return { language: info || extensionOf(mentioned[1]), filePath: normalizePath(mentioned[1]) }
  }

  return { language: info, filePath: '' }
}

function looksLikePath(value) {
  if (!value) return false
  // Needs an extension; a bare word like "bash" is a language, not a file.
  return /\.[A-Za-z0-9]+$/.test(value) && !/\s/.test(value)
}

function normalizePath(value) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function extensionOf(value) {
  return (value.split('.').pop() || '').toLowerCase()
}

const parsedMessages = computed(() => props.messages.map((message, index) => ({
  ...message,
  key: `${index}-${message.role}`,
  segments: message.role === 'assistant' ? parseSegments(message.content || '') : [],
})))

// ===== "@" file autocomplete =====
const mentionQuery = ref(null)
const mentionIndex = ref(0)

const mentionMatches = computed(() => {
  if (mentionQuery.value === null) return []
  const query = mentionQuery.value.toLowerCase()
  const pool = props.files
  const matches = query
    ? pool.filter((file) => file.toLowerCase().includes(query))
    : pool
  // Shallower paths first: they are usually the ones being asked about.
  return matches
    .slice()
    .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))
    .slice(0, 8)
})

/** Reads the "@token" immediately before the caret, if there is one. */
function updateMentionState() {
  const element = textareaRef.value
  if (!element) return
  const caret = element.selectionStart ?? 0
  const upToCaret = input.value.slice(0, caret)
  const match = upToCaret.match(/(?:^|\s)@([A-Za-z0-9_./\\-]*)$/)
  const nextQuery = match ? match[1] : null
  // Only reset the highlighted item when the query text itself changed (a
  // character typed or deleted). This runs on @keyup, which also fires right
  // after an ArrowDown/ArrowUp @keydown - preventDefault() on the keydown
  // does not suppress that keyup - so without this guard, every navigation
  // key immediately snapped the selection back to the first item on the very
  // next event, making keyboard navigation look completely broken.
  if (nextQuery !== mentionQuery.value) {
    mentionIndex.value = 0
  }
  mentionQuery.value = nextQuery
}

function applyMention(filePath) {
  const element = textareaRef.value
  if (!element) return
  const caret = element.selectionStart ?? 0
  const before = input.value.slice(0, caret).replace(/@([A-Za-z0-9_./\\-]*)$/, `@${filePath} `)
  input.value = before + input.value.slice(caret)
  mentionQuery.value = null
  nextTick(() => {
    element.focus()
    const position = before.length
    element.setSelectionRange(position, position)
    autoResize()
  })
}

/**
 * Moves the highlighted mention by `delta`, clamped to the list's ends
 * instead of wrapping around. Wrapping meant pressing ArrowDown past the
 * last item silently jumped back to the first one - indistinguishable from
 * "scrolling down is broken and it keeps resetting to the top". Also scrolls
 * the highlighted item into view, since the list can scroll independently of
 * which item is selected.
 */
function moveMentionSelection(delta) {
  const lastIndex = mentionMatches.value.length - 1
  mentionIndex.value = Math.min(lastIndex, Math.max(0, mentionIndex.value + delta))
  nextTick(() => {
    mentionMenuRef.value?.querySelector('.ws-mention-item--active')?.scrollIntoView({ block: 'nearest' })
  })
}

function handleKeydown(event) {
  if (mentionQuery.value !== null && mentionMatches.value.length) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveMentionSelection(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveMentionSelection(-1)
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      applyMention(mentionMatches.value[mentionIndex.value])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      mentionQuery.value = null
      return
    }
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    send()
  }
}

function send() {
  const text = input.value.trim()
  if (!text || props.isGenerating) return
  emit('send', text)
  input.value = ''
  mentionQuery.value = null
  nextTick(autoResize)
}

function autoResize() {
  const element = textareaRef.value
  if (!element) return
  element.style.height = '38px'
  element.style.height = `${Math.min(element.scrollHeight, 180)}px`
}

function insertWorkspaceToken() {
  input.value = input.value ? `@workspace ${input.value}` : '@workspace '
  nextTick(() => {
    textareaRef.value?.focus()
    autoResize()
  })
}

function scrollToBottom() {
  nextTick(() => {
    const element = scrollerRef.value
    if (element) element.scrollTop = element.scrollHeight
  })
}

watch(() => props.messages.map((message) => message.content).join('|'), scrollToBottom)
watch(input, () => nextTick(autoResize))
onMounted(autoResize)

function reasonLabel(reason) {
  if (reason === 'explicit') return 'disebut langsung'
  if (reason === 'target') return 'file dibuka'
  return 'hasil pencarian'
}
</script>

<template>
  <section class="ws-chat">
    <header class="ws-chat-header">
      <button class="ws-chat-collapse-btn" title="Tutup panel ini" @click="emit('collapse')">
        <PanelRightClose :size="15" />
      </button>
      <Sparkles :size="14" />
      <span class="ws-chat-title">AI Coding Assistant</span>
      <span v-if="activeFilePath" class="ws-chat-target" :title="`Konteks file aktif: ${activeFilePath}`">
        <Crosshair :size="11" />
        {{ activeFilePath.split('/').pop() }}
      </span>
    </header>

    <div ref="scrollerRef" class="ws-chat-messages">
      <div v-if="!messages.length" class="ws-chat-empty">
        <Bot :size="26" />
        <p class="ws-chat-empty-title">Tanya apa saja tentang proyek ini</p>
        <ul class="ws-chat-empty-tips">
          <li><code>@workspace</code> - cari di seluruh kode proyek</li>
          <li><code>@src/file.ts</code> - kirim satu file utuh sebagai konteks</li>
          <li>Tanpa keduanya - file yang sedang dibuka dipakai sebagai konteks</li>
        </ul>
      </div>

      <article
        v-for="message in parsedMessages"
        :key="message.key"
        class="ws-message"
        :class="`ws-message--${message.role}`"
      >
        <div class="ws-message-avatar">
          <User v-if="message.role === 'user'" :size="14" />
          <Bot v-else :size="14" />
        </div>

        <div class="ws-message-body">
          <!-- Which files the model was actually shown -->
          <div v-if="message.contextBlocks?.length" class="ws-context-chips">
            <span
              v-for="block in message.contextBlocks"
              :key="`${block.relPath}-${block.startLine}`"
              class="ws-context-chip"
              :class="`ws-context-chip--${block.reason}`"
              :title="`${block.relPath}${block.startLine ? ` (baris ${block.startLine}-${block.endLine})` : ''} - ${reasonLabel(block.reason)}${block.score ? `, skor ${block.score}` : ''}`"
            >
              <Search v-if="block.reason === 'search'" :size="10" />
              <Crosshair v-else-if="block.reason === 'target'" :size="10" />
              <FileCode v-else :size="10" />
              {{ block.relPath.split('/').pop() }}
            </span>
          </div>

          <div v-if="message.role === 'user'" class="ws-user-text">{{ message.content }}</div>

          <template v-else>
            <p v-if="!message.content && isGenerating" class="ws-thinking">
              Membaca kode<span class="ws-dots"><i></i><i></i><i></i></span>
            </p>

            <template v-for="(segment, index) in message.segments" :key="index">
              <!-- eslint-disable-next-line vue/no-v-html -- markdown-it with html:false; fenced code is split out before this -->
              <div v-if="segment.kind === 'text'" class="ws-prose" v-html="renderText(segment.content)"></div>
              <WorkspaceCodeBlock
                v-else
                :code="segment.content"
                :language="segment.language"
                :file-path="segment.filePath"
                :is-streaming="!segment.closed"
                :is-applying="applyingPath === segment.filePath"
                @diff="emit('diff', $event)"
                @apply="emit('apply', $event)"
              />
            </template>
          </template>
        </div>
      </article>

      <div v-if="errorMessage" class="ws-chat-error">
        <AlertCircle :size="14" />
        <span>{{ errorMessage }}</span>
      </div>
    </div>

    <!-- Composer -->
    <div class="ws-composer">
      <!-- "@" autocomplete -->
      <div v-if="mentionQuery !== null && mentionMatches.length" ref="mentionMenuRef" class="ws-mention-menu">
        <button
          v-for="(file, index) in mentionMatches"
          :key="file"
          class="ws-mention-item"
          :class="{ 'ws-mention-item--active': index === mentionIndex }"
          @mousedown.prevent="applyMention(file)"
        >
          <FileCode :size="12" />
          <span class="ws-mention-name">{{ file.split('/').pop() }}</span>
          <span class="ws-mention-path">{{ file }}</span>
        </button>
      </div>

      <div class="ws-composer-row">
        <button
          class="ws-composer-btn"
          title="Cari di seluruh workspace"
          type="button"
          @click="insertWorkspaceToken"
        >
          <Search :size="15" />
        </button>

        <textarea
          ref="textareaRef"
          v-model="input"
          rows="1"
          class="ws-textarea"
          :placeholder="isGenerating ? 'AI sedang menjawab...' : 'Tanya, atau ketik @ untuk memilih file...'"
          @keydown="handleKeydown"
          @keyup="updateMentionState"
          @click="updateMentionState"
        ></textarea>

        <button
          v-if="isGenerating"
          class="ws-send-btn ws-send-btn--stop"
          title="Hentikan"
          @click="emit('stop')"
        >
          <Square :size="15" fill="currentColor" />
        </button>
        <button
          v-else
          class="ws-send-btn"
          :class="{ 'ws-send-btn--active': input.trim() }"
          :disabled="!input.trim()"
          title="Kirim (Enter)"
          @click="send"
        >
          <Send :size="15" />
        </button>
      </div>

      <p class="ws-composer-hint">
        <kbd>@</kbd> pilih file · <kbd>Enter</kbd> kirim · <kbd>Shift+Enter</kbd> baris baru
      </p>
    </div>
  </section>
</template>

<style scoped>
.ws-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--color-bg-secondary);
  border-left: 1px solid var(--color-border);
}

.ws-chat-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-accent);
  font-size: 0.76rem;
  font-weight: 600;
  flex-shrink: 0;
}

.ws-chat-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.16s ease;
}

.ws-chat-collapse-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.ws-chat-title {
  /* Grows to fill the gap so the target chip and collapse button (whichever
     is present) always end up flush against the right edge, instead of
     relying on margin-left:auto on a chip that isn't always rendered. */
  flex: 1;
}

.ws-chat-target {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border: 1px solid var(--color-border);
  border-radius: 20px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 0.65rem;
  font-weight: 500;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  min-height: 0;
}

.ws-chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 16px;
  color: var(--color-text-muted);
  text-align: center;
}

.ws-chat-empty-title {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.ws-chat-empty-tips {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  text-align: left;
  font-size: 0.72rem;
  line-height: 1.9;
}

.ws-chat-empty-tips code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--color-bg-input);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--color-text-accent);
}

.ws-message {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

.ws-message-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.ws-message--user .ws-message-avatar {
  background: var(--color-accent-subtle);
  border-color: var(--color-accent);
  color: var(--color-text-accent);
}

.ws-message-body {
  flex: 1;
  min-width: 0;
}

.ws-user-text {
  padding: 7px 10px;
  border-radius: 9px;
  background: var(--color-bg-input);
  border: 1px solid var(--color-border);
  color: var(--color-text-primary);
  font-size: 0.79rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.ws-context-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.ws-context-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 20px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 0.62rem;
}

.ws-context-chip--explicit {
  border-color: rgba(139, 92, 246, 0.45);
  color: var(--color-text-accent);
}

.ws-context-chip--target {
  border-color: rgba(245, 158, 11, 0.45);
  color: #f59e0b;
}

.ws-thinking {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.76rem;
}

.ws-dots i {
  display: inline-block;
  width: 3px;
  height: 3px;
  margin-left: 2px;
  border-radius: 50%;
  background: currentColor;
  animation: ws-blink 1.4s infinite both;
}

.ws-dots i:nth-child(2) { animation-delay: 0.2s; }
.ws-dots i:nth-child(3) { animation-delay: 0.4s; }

@keyframes ws-blink {
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}

.ws-prose {
  color: var(--color-text-primary);
  font-size: 0.79rem;
  line-height: 1.65;
  word-break: break-word;
}

.ws-prose :deep(p) { margin: 0 0 8px; }
.ws-prose :deep(p:last-child) { margin-bottom: 0; }
.ws-prose :deep(ul),
.ws-prose :deep(ol) { margin: 0 0 8px; padding-left: 20px; }
.ws-prose :deep(li) { margin-bottom: 3px; }
.ws-prose :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--color-bg-input);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--color-text-accent);
}
.ws-prose :deep(a) { color: var(--color-text-accent); }
.ws-prose :deep(strong) { color: var(--color-text-primary); font-weight: 700; }

.ws-chat-error {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-danger);
  font-size: 0.74rem;
}

/* ===== Composer ===== */
.ws-composer {
  position: relative;
  padding: 10px 12px 8px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.ws-mention-menu {
  position: absolute;
  bottom: calc(100% - 4px);
  left: 12px;
  right: 12px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--color-border-light);
  border-radius: 9px;
  background: var(--color-bg-tertiary);
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.35);
  z-index: 20;
}

.ws-mention-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 9px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-family: var(--font-sans);
  font-size: 0.73rem;
  text-align: left;
  cursor: pointer;
}

.ws-mention-item:hover,
.ws-mention-item--active {
  background: var(--color-accent-subtle);
  color: var(--color-text-accent);
}

.ws-mention-name {
  font-weight: 600;
  flex-shrink: 0;
}

.ws-mention-path {
  font-family: var(--font-mono);
  font-size: 0.64rem;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-composer-row {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 5px;
  border: 1px solid var(--color-border);
  border-radius: 11px;
  background: var(--color-bg-input);
}

/* Matches .ws-send-btn's idle appearance (same padding/background/radius) so
   the two ends of the composer row read as a matched pair instead of one
   looking like a plain icon and the other a proper button. */
.ws-composer-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  border: none;
  border-radius: 8px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.16s ease;
  flex-shrink: 0;
}

.ws-composer-btn:hover {
  color: var(--color-text-accent);
  background: var(--color-bg-hover);
}

.ws-textarea {
  flex: 1;
  min-width: 0;
  min-height: 38px;
  max-height: 180px;
  padding: 9px 2px;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: 0.79rem;
  line-height: 1.5;
  resize: none;
  outline: none;
}

.ws-send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  border: none;
  border-radius: 8px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.18s ease;
  flex-shrink: 0;
}

.ws-send-btn--active {
  background: var(--color-accent);
  color: #fff;
}

.ws-send-btn--stop {
  background: rgba(239, 68, 68, 0.15);
  color: var(--color-danger);
}

.ws-send-btn:disabled { cursor: not-allowed; }

.ws-composer-hint {
  margin: 6px 0 0;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 0.65rem;
}

.ws-composer-hint kbd {
  padding: 1px 4px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg-tertiary);
  font-family: var(--font-mono);
  font-size: 0.62rem;
}
</style>
