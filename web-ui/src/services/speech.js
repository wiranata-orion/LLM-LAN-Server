/**
 * Web Speech STT/TTS (#1) - both are native browser APIs (SpeechRecognition,
 * speechSynthesis), so this stays dependency-free like the rest of the app's
 * "local first" stance. Availability varies by browser (Chrome/Edge support
 * both well; Firefox has neither SpeechRecognition nor a great voice list),
 * so every caller must check isSttSupported()/isTtsSupported() first rather
 * than assuming either exists.
 */
import { ref } from 'vue'
import { getSettings } from './api.js'

const SpeechRecognitionCtor = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : undefined

export function isSttSupported() {
  return !!SpeechRecognitionCtor
}

export function isTtsSupported() {
  return typeof window !== 'undefined' && !!window.speechSynthesis
}

/**
 * The browser's installed TTS voices (Settings > Suara & Audio's voice
 * picker reads this). Can legitimately return [] on the very first call in
 * some browsers - voice lists load asynchronously - see onVoicesChanged
 * below for the event that fires once they're actually ready.
 */
export function getAvailableVoices() {
  return isTtsSupported() ? window.speechSynthesis.getVoices() : []
}

/** Subscribes to the browser's voice list becoming available/changing; returns an unsubscribe function. */
export function onVoicesChanged(callback) {
  if (!isTtsSupported()) return () => {}
  window.speechSynthesis.addEventListener('voiceschanged', callback)
  return () => window.speechSynthesis.removeEventListener('voiceschanged', callback)
}

function resolveVoice(voiceName) {
  if (!voiceName) return null
  return getAvailableVoices().find((voice) => voice.name === voiceName) || null
}

/**
 * Wraps SpeechRecognition into a small start/stop handle, using Settings >
 * Suara & Audio's language (falling back to the browser's own configured
 * language if never set) - "auto-language detection" per the original
 * spec doesn't exist as a real SpeechRecognition feature, each session is
 * pinned to one BCP-47 tag, so a persisted, user-picked language is the
 * honest equivalent.
 * @param {{ onResult: (transcript: string, isFinal: boolean) => void, onEnd?: () => void, onError?: (message: string) => void }} handlers
 * @returns {{ start: () => void, stop: () => void } | null} null if STT isn't supported here.
 */
export function createSpeechRecognizer({ onResult, onEnd, onError }) {
  if (!SpeechRecognitionCtor) return null

  const recognition = new SpeechRecognitionCtor()
  recognition.lang = getSettings().speechLang || (typeof navigator !== 'undefined' && navigator.language) || 'id-ID'
  recognition.continuous = true
  recognition.interimResults = true

  recognition.onresult = (event) => {
    // Only the results from this event batch, not the whole session history -
    // SpeechRecognition re-fires earlier finalized results otherwise, which
    // would re-append already-transcribed text every time a new phrase lands.
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i]
      onResult(result[0].transcript, result.isFinal)
    }
  }
  recognition.onerror = (event) => {
    onError?.(event.error || 'Speech recognition error')
  }
  recognition.onend = () => {
    onEnd?.()
  }

  return {
    start: () => recognition.start(),
    stop: () => recognition.stop(),
  }
}

// ---- Stripping markdown/code/LaTeX before speech (TTS) ----

// Our own widget fences (see MessageBubble.vue) carry JSON/diagram source,
// never prose meant to be read aloud - stripped as a whole block, same as an
// ordinary ```code``` fence.
const WIDGET_TAGS = ['mermaid', 'clarify', 'flashcards', 'mindmap', 'decision-matrix']

/**
 * @param {string} markdown
 * @returns {string} Plain, speakable text - see the ordered steps inline below.
 */
export function stripForSpeech(markdown) {
  let text = markdown || ''

  // 1. Fenced code blocks and widget blocks - entirely removed, not narrated
  //    (reading "graph TD, A dash dash greater than B" aloud helps no one).
  text = text.replace(/```(?:[a-zA-Z0-9_-]+)?\n[\s\S]*?```/g, ' ')
  for (const tag of WIDGET_TAGS) {
    text = text.replace(new RegExp('```' + tag + '\\n[\\s\\S]*?```', 'g'), ' ')
  }

  // 2. LaTeX math - $$...$$, \[...\], $...$, \(...\) - removed rather than
  //    read as raw symbols ("x dollar sign squared dollar sign").
  text = text.replace(/\$\$[\s\S]*?\$\$/g, ' ')
  text = text.replace(/\\\[[\s\S]*?\\\]/g, ' ')
  text = text.replace(/\\\([^\n]*?\\\)/g, ' ')
  text = text.replace(/\$[^$\n]+?\$/g, ' ')

  // 3. HTML tags - the markdown renderer never allows raw HTML through
  //    (see MessageBubble.vue's html:false), but a model could still emit
  //    literal tag-looking text, so this is stripped defensively regardless.
  text = text.replace(/<[^>]+>/g, ' ')

  // 4. Markdown syntax -> keep the words, drop the markup around them.
  text = text.replace(/^#{1,6}\s+/gm, '') // headings
  text = text.replace(/`([^`]+)`/g, '$1') // inline code
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) -> text
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
  text = text.replace(/(\*|_)(.*?)\1/g, '$2') // italic
  text = text.replace(/~~(.*?)~~/g, '$1') // strikethrough
  text = text.replace(/^\s*[-*+]\s+/gm, '') // bullet list markers
  text = text.replace(/^\s*\d+\.\s+/gm, '') // numbered list markers
  text = text.replace(/^\s*>\s?/gm, '') // blockquote markers

  // 5. Collapse whatever whitespace all the removals above left behind.
  return text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
}

/**
 * Which text is currently being read aloud, shared across every caller
 * (MessageBubble.vue mounts one speaker button per assistant reply) -
 * speechSynthesis is a single global resource, only one utterance can ever
 * actually be speaking, so "am I the one speaking" has to be derived from
 * one shared value rather than independent per-component state. Without
 * this, calling speak() again while a DIFFERENT reply is mid-utterance could
 * leave that other reply's own local "is speaking" flag stuck true forever
 * if the browser doesn't fire `onend` for the utterance that
 * speechSynthesis.cancel() just interrupted - a real, known inconsistency
 * across browsers, not a hypothetical one.
 */
export const speakingText = ref(null)

/**
 * Speaks `text` (already stripped - see stripForSpeech), cancelling any
 * speech already in progress first. Rate/pitch/volume/voice/language default
 * to whatever's persisted in Settings > Suara & Audio - passed explicitly
 * only by that Settings tab's own "Uji Suara" preview button, which needs to
 * audition DRAFT values before the user has actually saved them.
 * @param {string} text
 * @param {{ rate?: number, pitch?: number, volume?: number, voiceName?: string, lang?: string, onEnd?: () => void }} [overrides]
 */
export function speak(text, overrides = {}) {
  if (!isTtsSupported() || !text) return
  const settings = getSettings()
  const rate = overrides.rate ?? settings.ttsRate ?? 1
  const pitch = overrides.pitch ?? settings.ttsPitch ?? 1
  const volumePercent = overrides.volume ?? settings.ttsVolume ?? 100
  const lang = overrides.lang || settings.speechLang || (typeof navigator !== 'undefined' && navigator.language) || 'id-ID'
  const voice = resolveVoice(overrides.voiceName ?? settings.ttsVoiceName)

  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = Math.min(2, Math.max(0.5, rate))
  utterance.pitch = Math.min(1.5, Math.max(0.5, pitch))
  utterance.volume = Math.min(1, Math.max(0, volumePercent / 100))
  // A matched voice carries its own locale; only fall back to the language
  // setting when no specific voice was resolved (e.g. it's unavailable on
  // this browser/OS).
  utterance.lang = voice?.lang || lang
  if (voice) utterance.voice = voice
  utterance.onend = () => {
    if (speakingText.value === text) speakingText.value = null
    overrides.onEnd?.()
  }
  speakingText.value = text
  window.speechSynthesis.speak(utterance)
}

export function stopSpeaking() {
  if (!isTtsSupported()) return
  window.speechSynthesis.cancel()
  speakingText.value = null
}
