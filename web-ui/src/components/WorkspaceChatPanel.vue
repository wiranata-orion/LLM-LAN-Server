<script setup>
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
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
  History,
  Plus,
  Trash2,
} from 'lucide-vue-next'
import WorkspaceCodeBlock from './WorkspaceCodeBlock.vue'
import { parseWorkspaceReplySegments, deriveFallbackFilePath } from '../services/workspaceChatParsing.js'
import {
  chatSessions,
  activeChatId,
  isChatHistoryLoading,
  startNewChat,
  selectChatSession,
  deleteChatSessionById,
  getChangeDecision,
  clearChangeDecision,
  acceptChange,
  rejectChange,
  requestDiff,
} from '../services/workspaceStore.js'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  isGenerating: { type: Boolean, default: false },
  // Flat list of project paths, for the "@" autocomplete.
  files: { type: Array, default: () => [] },
  activeFilePath: { type: String, default: '' },
  applyingPath: { type: String, default: '' },
  errorMessage: { type: String, default: '' },
})

const emit = defineEmits(['send', 'stop', 'collapse'])

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

const parsedMessages = computed(() => props.messages.map((message, index) => {
  const fallbackFilePath = deriveFallbackFilePath(message.contextBlocks)
  const segments = message.role === 'assistant'
    ? parseWorkspaceReplySegments(message.content || '', { fallbackFilePath })
    : []
  const isLast = index === props.messages.length - 1
  const stillStreaming = isLast && props.isGenerating

  // The model was shown a file the user explicitly named (@path), but the
  // finished reply contains no labelled code block for it - it answered with
  // explanation/advice instead of actually editing the file. Surfacing this
  // is what the "Diff View"/"Terima"/"Tolak" buttons would otherwise leave
  // silent: there's nothing to click, and no obvious reason why.
  const hasExplicitFileContext = message.contextBlocks?.some((block) => block.reason === 'explicit') || false
  const hasEditableCode = segments.some((segment) => segment.kind === 'code' && segment.filePath)
  const showNoEditHint = message.role === 'assistant' && !stillStreaming
    && hasExplicitFileContext && !hasEditableCode && Boolean(message.content)

  return {
    ...message,
    key: `${index}-${message.role}`,
    segments,
    showNoEditHint,
  }
}))

/**
 * Renders a user message with any @workspace / @path/to/file tokens as a
 * highlighted tag instead of plain text, so a reference reads the same way
 * here as it does in the "@" autocomplete that inserted it. HTML-escaped
 * first since this goes through v-html.
 */
const MENTION_TAG_PATTERN = /@([A-Za-z0-9_./\\-]+)/g

function renderUserMessage(text) {
  const escaped = escapeHtml(text)
  return escaped.replace(MENTION_TAG_PATTERN, (match, token) => {
    if (token.toLowerCase() !== 'workspace' && !token.includes('.') && !token.includes('/')) return match
    return `<span class="ws-mention-tag">@${token}</span>`
  })
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

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

// Tracks whether the user has deliberately scrolled away from the bottom, so
// a reply streaming in doesn't fight them - every token used to call
// scrollToBottom() unconditionally, snapping back down the instant they tried
// to scroll up to read an earlier message.
const userScrolledAway = ref(false)
const SCROLL_BOTTOM_THRESHOLD = 24

function isNearBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < SCROLL_BOTTOM_THRESHOLD
}

function handleMessagesScroll() {
  const element = scrollerRef.value
  if (!element) return
  userScrolledAway.value = !isNearBottom(element)
}

function scrollToBottom() {
  if (userScrolledAway.value) return
  nextTick(() => {
    const element = scrollerRef.value
    if (element) element.scrollTop = element.scrollHeight
  })
}

watch(() => props.messages.map((message) => message.content).join('|'), scrollToBottom)
// A brand-new message (the user just sent one, or a reply just started) means
// "jump back to the bottom" even if they were reading scrollback a moment ago.
watch(() => props.messages.length, () => {
  userScrolledAway.value = false
  scrollToBottom()
})
watch(input, () => nextTick(autoResize))
onMounted(autoResize)

// ===== Accept / reject a proposed change - see workspaceStore.js =====
function handleAccept(messageIndex, segmentIndex, { filePath, newContent }) {
  acceptChange({ messageIndex, segmentIndex, filePath, newContent })
}

function handleReject(messageIndex, segmentIndex) {
  rejectChange({ messageIndex, segmentIndex })
}

function handleUndo(messageIndex, segmentIndex) {
  clearChangeDecision(messageIndex, segmentIndex)
}

// ===== Chat history dropdown =====
const showHistoryMenu = ref(false)
const historyWrapperRef = ref(null)

function toggleHistoryMenu() {
  showHistoryMenu.value = !showHistoryMenu.value
}

function handleNewChat() {
  startNewChat()
  showHistoryMenu.value = false
}

async function handleSelectChat(id) {
  await selectChatSession(id)
  showHistoryMenu.value = false
}

function handleDeleteChat(id) {
  deleteChatSessionById(id)
}

function handleClickOutsideHistory(event) {
  if (historyWrapperRef.value && !historyWrapperRef.value.contains(event.target)) {
    showHistoryMenu.value = false
  }
}

/** Compact "5 menit lalu" style relative time for the history list. */
function formatRelativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'baru saja'
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} hari lalu`
  return new Date(iso).toLocaleDateString('id-ID')
}

onMounted(() => window.addEventListener('click', handleClickOutsideHistory))
onUnmounted(() => window.removeEventListener('click', handleClickOutsideHistory))

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

      <div ref="historyWrapperRef" class="ws-history-wrapper">
        <button class="ws-chat-history-btn" title="Riwayat chat" @click="toggleHistoryMenu">
          <History :size="15" />
        </button>
        <Transition name="fade">
          <div v-if="showHistoryMenu" class="ws-history-menu glass">
            <button class="ws-history-new-btn" @click="handleNewChat">
              <Plus :size="13" />
              <span>Chat Baru</span>
            </button>
            <div class="ws-history-list">
              <p v-if="isChatHistoryLoading" class="ws-history-empty">Memuat...</p>
              <p v-else-if="!chatSessions.length" class="ws-history-empty">Belum ada riwayat chat tersimpan.</p>
              <div
                v-for="session in chatSessions"
                :key="session.id"
                class="ws-history-item"
                :class="{ 'ws-history-item--active': session.id === activeChatId }"
                role="button"
                tabindex="0"
                @click="handleSelectChat(session.id)"
              >
                <div class="ws-history-item-main">
                  <span class="ws-history-item-title" :title="session.title">{{ session.title || 'Chat baru' }}</span>
                  <span class="ws-history-item-meta">{{ formatRelativeTime(session.updatedAt) }} · {{ session.messageCount }} pesan</span>
                </div>
                <button class="ws-history-delete-btn" title="Hapus chat ini" @click.stop="handleDeleteChat(session.id)">
                  <Trash2 :size="12" />
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </header>

    <div ref="scrollerRef" class="ws-chat-messages" @scroll="handleMessagesScroll">
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
        v-for="(message, messageIndex) in parsedMessages"
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

          <!-- eslint-disable-next-line vue/no-v-html -- HTML-escaped first; only wraps @mentions in a tag span -->
          <div v-if="message.role === 'user'" class="ws-user-text" v-html="renderUserMessage(message.content)"></div>

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
                :decision="getChangeDecision(messageIndex, index)"
                @diff="requestDiff({ ...$event, messageIndex, segmentIndex: index })"
                @accept="handleAccept(messageIndex, index, $event)"
                @reject="handleReject(messageIndex, index)"
                @undo="handleUndo(messageIndex, index)"
              />
            </template>

            <div v-if="message.showNoEditHint" class="ws-no-edit-hint">
              <AlertCircle :size="13" />
              <span>
                AI menjawab dengan penjelasan, bukan perubahan file. Coba lebih tegas, misalnya:
                <em>"Tulis ulang seluruh isi file ini agar ..."</em> atau <em>"Ganti fungsi X menjadi ..."</em>.
              </span>
            </div>
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

      <div class="ws-composer-box">
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

        <div class="ws-composer-divider"></div>

        <div class="ws-composer-toolbar">
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

/* ===== Chat history dropdown ===== */
.ws-history-wrapper {
  position: relative;
  flex-shrink: 0;
}

.ws-chat-history-btn {
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

.ws-chat-history-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.ws-history-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 260px;
  max-height: 320px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border-light);
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.4);
  z-index: 30;
  overflow: hidden;
}

.ws-history-new-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 12px;
  border: none;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-accent);
  font-family: var(--font-sans);
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}

.ws-history-new-btn:hover {
  background: var(--color-accent-subtle);
}

.ws-history-list {
  overflow-y: auto;
  min-height: 0;
}

.ws-history-empty {
  margin: 0;
  padding: 16px 12px;
  color: var(--color-text-muted);
  font-size: 0.72rem;
  text-align: center;
}

.ws-history-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.12s ease;
}

.ws-history-item:hover {
  background: var(--color-bg-hover);
}

.ws-history-item--active {
  background: var(--color-accent-subtle);
}

.ws-history-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ws-history-item-title {
  color: var(--color-text-primary);
  font-size: 0.75rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-history-item-meta {
  color: var(--color-text-muted);
  font-size: 0.65rem;
}

.ws-history-delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.ws-history-delete-btn:hover {
  color: var(--color-danger);
  background: rgba(239, 68, 68, 0.12);
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

.ws-user-text :deep(.ws-mention-tag) {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--color-accent-subtle);
  color: var(--color-text-accent);
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 0.76rem;
  white-space: nowrap;
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

.ws-no-edit-hint {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(245, 158, 11, 0.4);
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
  font-size: 0.73rem;
  line-height: 1.55;
}

.ws-no-edit-hint svg {
  flex-shrink: 0;
  margin-top: 1px;
}

.ws-no-edit-hint em {
  font-style: normal;
  font-weight: 600;
  color: var(--color-text-primary);
}

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

/* Stacked layout: textarea on top, a divider line, then the send button
   below it on its own row - instead of the button sitting beside the input. */
.ws-composer-box {
  border: 1px solid var(--color-border);
  border-radius: 11px;
  background: var(--color-bg-input);
  overflow: hidden;
}

.ws-composer-divider {
  height: 1px;
  background: var(--color-border);
}

.ws-composer-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 6px;
}

.ws-textarea {
  width: 100%;
  min-width: 0;
  min-height: 38px;
  max-height: 180px;
  padding: 9px 10px;
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
