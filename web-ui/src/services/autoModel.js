/**
 * Model Auto: picks which model handles a message automatically, based on a
 * lightweight heuristic classification of the task, instead of always using
 * whichever model the user manually selected in the sidebar.
 *
 * This stays a client-side heuristic (no extra LLM call) so it costs nothing
 * and works even when only one small model is installed.
 */

export const TASK_CATEGORIES = [
  {
    id: 'general',
    label: 'Percakapan Umum',
    desc: 'Obrolan sehari-hari, pertanyaan singkat, dan permintaan umum lainnya.',
  },
  {
    id: 'coding',
    label: 'Coding & Teknis',
    desc: 'Menulis atau memperbaiki kode, debugging, pertanyaan seputar pemrograman.',
  },
  {
    id: 'math',
    label: 'Matematika & Logika',
    desc: 'Perhitungan, soal matematika, penalaran logis, dan reasoning yang butuh ketelitian.',
  },
  {
    id: 'writing',
    label: 'Penulisan & Kreatif',
    desc: 'Menulis artikel, cerita, puisi, copywriting, dan brainstorming ide.',
  },
  {
    id: 'document',
    label: 'Dokumen & Ringkasan',
    desc: 'Meringkas, menganalisis, atau menjawab pertanyaan dari file/dokumen yang dilampirkan.',
  },
]

const CODING_PATTERN = /```|\b(kode|code|coding|bug|error|debug|compile|refactor|fungsi|function|class\s|const\s|import\s|def\s|script|syntax|python|javascript|typescript|java\b|css|html|sql|regex|api|library|package\.json|npm|git\b)\b/i
const MATH_PATTERN = /\b(hitung|berapa|matematika|persamaan|integral|turunan|statistik|logika|logaritma|aljabar|geometri|probabilitas|rumus|kalkulus)\b|[0-9]\s*[+\-*/^%]\s*[0-9]/i
const WRITING_PATTERN = /\b(tulis(kan)?|karang(an)?|cerita|puisi|artikel|caption|copywriting|brainstorm|ide konten|naskah|skenario)\b/i
const DOCUMENT_PATTERN = /\b(ringkas(kan)?|rangkum(an)?|dokumen|summary|summarize|file (ini|tersebut)|lampiran|attachment)\b/i

/**
 * Classify a user message into one of TASK_CATEGORIES ids.
 * @param {string} text
 * @param {{ hasAttachment?: boolean }} [opts]
 */
export function classifyTask(text, opts = {}) {
  const message = (text || '').trim()
  if (opts.hasAttachment || DOCUMENT_PATTERN.test(message)) return 'document'
  if (CODING_PATTERN.test(message)) return 'coding'
  if (MATH_PATTERN.test(message)) return 'math'
  if (WRITING_PATTERN.test(message)) return 'writing'
  return 'general'
}

const EMBED_PATTERN = /embed|bge-m3|all-minilm|minilm/i
const VISION_PATTERN = /vision|llava|moondream|bakllava/i
const CODING_MODEL_PATTERN = /coder|code-|codellama|starcoder/i
const REASONING_MODEL_PATTERN = /deepseek-r1|-r1(:|$)|wizardmath|mathstral|reasoning/i

function modelName(m) {
  return typeof m === 'string' ? m : (m?.name || '')
}

function modelSize(m) {
  return typeof m === 'object' && m ? (m.size || 0) : 0
}

/**
 * Suggest a default task -> model map from the models actually installed on
 * a device, so "Model Auto" is usable out of the box without manual setup.
 * Only ever used to pre-fill the mapping; the user can override every entry.
 */
export function getDefaultModelMap(models) {
  const list = (models || []).filter((m) => modelName(m))
  if (!list.length) return {}

  const textModels = list.filter((m) => !EMBED_PATTERN.test(modelName(m)) && !VISION_PATTERN.test(modelName(m)))
  const pool = textModels.length ? textModels : list

  const byName = (pattern) => pool.filter((m) => pattern.test(modelName(m)))
  const smallest = (arr) => [...arr].sort((a, b) => (modelSize(a) || Infinity) - (modelSize(b) || Infinity))[0]
  const largest = (arr) => [...arr].sort((a, b) => (modelSize(b) || 0) - (modelSize(a) || 0))[0]

  const codingCandidates = byName(CODING_MODEL_PATTERN)
  const mathCandidates = byName(REASONING_MODEL_PATTERN)

  const usedNames = new Set([
    ...codingCandidates.map(modelName),
    ...mathCandidates.map(modelName),
  ])
  const remaining = pool.filter((m) => !usedNames.has(modelName(m)))
  const generalFallback = remaining.length ? remaining : pool
  const writingFallback = remaining.length ? remaining : pool

  const general = smallest(generalFallback) || pool[0]
  const coding = codingCandidates.length ? smallest(codingCandidates) : general
  const math = mathCandidates.length ? largest(mathCandidates) : general
  const writing = largest(writingFallback) || general
  const document = writing

  return {
    general: modelName(general),
    coding: modelName(coding),
    math: modelName(math),
    writing: modelName(writing),
    document: modelName(document),
  }
}

/**
 * Resolve which model should actually be used for a message when Model Auto
 * is enabled: pick the mapped model for the detected category, but fall back
 * gracefully if it is missing or no longer installed on this device.
 */
export function resolveAutoModel({ text, hasAttachment, map, availableModels, fallbackModel }) {
  const category = classifyTask(text, { hasAttachment })
  const available = new Set((availableModels || []).map((m) => modelName(m)))
  const mapped = map?.[category]
  const resolvedModel = mapped && (available.size === 0 || available.has(mapped)) ? mapped : fallbackModel
  return { category, model: resolvedModel }
}
