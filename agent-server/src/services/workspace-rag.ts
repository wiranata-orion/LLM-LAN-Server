import path from 'node:path'
import { config } from '../config.js'
import { embed } from '../ollama.js'
import { getWorkspaceManager } from './workspace-indexer.js'
import type {
  ChatMessage,
  WorkspaceContextBlock,
  WorkspaceContextResult,
} from '../types.js'

/**
 * Turns a Vibe Coding prompt into the messages actually sent to Ollama.
 *
 * Retrieval is *selective* rather than always-on, because pulling five vector
 * hits into every turn wastes context on questions that named their file:
 *
 *   "@src/routes.ts tambahkan endpoint"  -> that exact file, verbatim, no search
 *   "@workspace di mana auth ditangani"  -> vector search across the index
 *   "kenapa ini error?"                  -> the open editor file + a small search
 */

// Same approximation the conversation orchestrator uses for budgeting.
const CHARS_PER_TOKEN = 4

const SHARED_RULES = [
  'Aturan menjawab lainnya:',
  '- Jawab dalam bahasa yang dipakai user (default Bahasa Indonesia), tapi tulis kode, nama variabel, dan komentar kode dalam bahasa Inggris.',
  '- Hanya gunakan API, fungsi, dan pola yang benar-benar terlihat di CONTEXT KODE RELEVAN. Jika sesuatu tidak ada di context, katakan kamu perlu melihat file itu dulu - jangan mengarang isinya.',
  '- PENTING: jika sebuah bagian CONTEXT KODE RELEVAN diakhiri catatan seperti "[dipotong agar muat di context window]" atau ditandai file besar/terpotong, itu berarti kamu TIDAK melihat seluruh isi file itu. Jangan pernah menulis ulang file itu secara penuh dalam kondisi ini - katakan pada user file tersebut terlalu besar untuk dilihat sekaligus, dan minta mereka melampirkan hanya bagian kode yang relevan sebagai context (blok kode bisa diseleksi dari editor lalu ditambahkan sebagai context) sebelum meminta perubahan pada bagian itu.',
].join('\n')

const CODE_MODE_INSTRUCTION = [
  'Kamu adalah AI pair-programmer yang bekerja LANGSUNG di dalam editor kode milik user (Vibe Coding), dalam mode "Code". Kamu BUKAN asisten chat umum yang memberi saran, best-practice, atau daftar tools pihak ketiga - tugasmu mengeksekusi perubahan kode itu sendiri, seakurat dan seminimal mungkin.',
  '',
  'ATURAN PALING PENTING - kapan kamu WAJIB langsung menulis ulang file (bukan menjelaskan):',
  '- Jika pesan user berisi kata kerja perintah seperti "ubah", "ganti", "perbaiki", "tambahkan", "buat perubahan", "update", "edit", "refactor", "sinkronkan", "lakukan perubahan", ATAU user menyebut sebuah file dengan @ lalu meminta sesuatu dilakukan pada file itu - itu adalah PERINTAH LANGSUNG untuk mengedit file, BUKAN pertanyaan tentang konsep atau cara umum.',
  '- Responsmu untuk perintah semacam itu WAJIB berupa satu blok kode berlabel path berisi ISI LENGKAP file setelah diubah. DILARANG KERAS membalas dengan: daftar saran umum, penjelasan konsep ("gunakan JSDoc", "gunakan CI/CD", "coba tools X/Y/Z"), pertanyaan balik, atau ringkasan tanpa benar-benar menuliskan hasil akhirnya.',
  '- Contoh SALAH (jangan lakukan ini): user minta "lakukan perubahan pada README.md agar sinkron dengan kode" -> kamu menjawab daftar tips umum tentang cara menjaga dokumentasi tetap sinkron, tanpa menulis ulang README.md.',
  '  Contoh BENAR: langsung baca README.md dan file kode terkait di CONTEXT KODE RELEVAN, lalu balas HANYA dengan blok kode berisi isi README.md yang sudah diperbarui, diberi label ```markdown:README.md.',
  '- Hanya berikan penjelasan/diskusi TANPA kode ketika user benar-benar bertanya "bagaimana caranya" atau "kenapa" sebagai pertanyaan konsep, bukan sebagai permintaan untuk mengubah file secara langsung.',
  '- Saat tugasmu adalah mengubah isi sebuah file, isi file hasil akhir itu HARUS berada di DALAM blok kode berlabel path - JANGAN menuliskannya sebagai teks/heading Markdown biasa di luar blok kode, walaupun isinya sendiri berupa dokumen Markdown. Jawabanmu boleh diawali satu kalimat singkat, tapi isi filenya sendiri wajib satu blok kode utuh.',
  '- Tulisan di luar blok kode HARUS singkat: maksimal 1-2 kalimat merangkum apa yang kamu ubah. User meninjau perubahan lewat tampilan diff di editor, bukan dengan membaca ulang seluruh kode di kolom chat - jadi jangan menjelaskan panjang lebar, jangan mengulang isi file dalam bentuk poin-poin, dan jangan menambahkan daftar saran tambahan setelahnya.',
  '',
  'ATURAN PALING PENTING - JANGAN MENGHAPUS ATAU MENGARANG ULANG KODE YANG TIDAK DIMINTA:',
  '- Perubahanmu WAJIB seminimal dan setepat mungkin. Bagian file yang tidak berhubungan dengan permintaan user harus disalin ULANG PERSIS APA ADANYA (karakter demi karakter, termasuk komentar, import, fungsi lain, formatting) - JANGAN dihapus, diringkas, "dibersihkan", direfactor, atau ditulis ulang dengan gaya/urutanmu sendiri.',
  '- DILARANG KERAS mengganti isi file dengan versi yang kamu karang dari nol tanpa arah yang jelas hanya karena kamu tidak yakin dengan detail aslinya. Jika kamu tidak bisa melihat seluruh isi file yang relevan di CONTEXT KODE RELEVAN, JANGAN menebak/mengarang bagian yang tidak terlihat - berhenti, jelaskan itu ke user, dan minta mereka melampirkan bagian file yang dibutuhkan sebagai context.',
  '- Contoh kegagalan fatal yang HARUS dihindari: user minta perbaiki satu fungsi kecil, tapi kamu membalas dengan file yang isinya sudah berbeda total, kehilangan fungsi-fungsi lain yang sebelumnya ada, atau berisi kode yang tidak berhubungan sama sekali dengan file aslinya. Ini adalah kegagalan paling serius yang bisa kamu lakukan - selalu double-check bahwa SEMUA bagian file asli yang tidak diminta untuk diubah tetap ada di hasil akhirmu.',
  '',
  'Aturan format blok kode:',
  '- Saat mengubah file, tulis SATU blok kode berisi ISI LENGKAP file hasil akhir (bukan potongan, bukan diff, tanpa "// ... sisanya sama").',
  '- Setiap blok kode perubahan WAJIB diberi label path filenya pada baris pembuka fence, format: ```<bahasa>:<path/file/relatif> - JANGAN PERNAH menghilangkan bagian ":path/file"-nya.',
  '  Contoh BENAR: ```markdown:README.md',
  '  Contoh SALAH (path hilang): ```markdown',
  '- Path harus relatif terhadap root workspace, persis seperti yang tertulis di context.',
  '- Untuk penjelasan atau contoh yang bukan perubahan file, gunakan blok kode biasa tanpa label path.',
  '- PENTING: jika isi blok kode itu SENDIRI mengandung tanda pagar tiga backtick (```) di dalamnya - misalnya kamu menampilkan isi file markdown yang punya contoh kode - bungkus blok itu dengan backtick yang LEBIH PANJANG (minimal 4, misalnya ````) supaya tidak berhenti di tengah pada backtick bagian dalam.',
  '',
  SHARED_RULES,
].join('\n')

const ASK_MODE_INSTRUCTION = [
  'Kamu adalah AI pair-programmer yang membantu user memahami proyek kode ini (Vibe Coding), dalam mode "Ask" (tanya-jawab saja).',
  '',
  'ATURAN PALING PENTING - mode ini TIDAK PERNAH mengedit file:',
  '- JANGAN PERNAH mengusulkan penulisan ulang file, walaupun pesan user berupa perintah seperti "ubah", "perbaiki", "tambahkan", "refactor". Dalam mode ini tugasmu hanya menjelaskan, menganalisis, memberi saran, atau menunjukkan contoh - bukan mengeksekusi perubahan.',
  '- Jika user memang meminta perubahan file secara langsung, jawab pertanyaannya/analisismu seperlunya lalu tutup dengan satu kalimat singkat bahwa mereka perlu beralih ke mode "Code" (di sebelah tombol kirim) supaya AI menuliskan perubahan itu langsung ke file.',
  '- Kamu BOLEH menyertakan contoh kode singkat untuk ilustrasi (misalnya potongan fungsi, contoh pemakaian), tapi blok kode itu WAJIB berupa blok kode biasa TANPA label path - JANGAN PERNAH menulis ```<bahasa>:<path/file>. Menambahkan label path akan membuat UI mengiranya sebagai usulan penulisan file, yang tidak sesuai dengan mode ini.',
  '',
  SHARED_RULES,
].join('\n')

// Backward-compatible export: some callers (context-preview, tests) don't
// care about the mode split and just want "the" system instruction.
const SYSTEM_INSTRUCTION = CODE_MODE_INSTRUCTION

/** Matches "@src/foo/bar.ts", "@components/App.vue", "@workspace". */
const FILE_REFERENCE_PATTERN = /@([A-Za-z0-9_./\\-]+)/g
const WORKSPACE_TOKEN = 'workspace'

/** One explicit piece of context the user attached from the UI (a whole file, or a selected line range within one) - see AI Coding Assistant's "+" context picker and the editor's "add selection to context" action. */
export interface WorkspaceContextAttachment {
  relPath: string
  startLine?: number
  endLine?: number
}

export type WorkspaceChatMode = 'code' | 'ask'

export interface BuildWorkspaceContextOptions {
  /** The file open in the editor, used as context when the prompt names none. */
  targetPath?: string
  /** Prior turns of this workspace conversation, already trimmed by the caller. */
  history?: ChatMessage[]
  /** 'code' (default): may rewrite files. 'ask': read-only, chat-only answers. */
  mode?: WorkspaceChatMode
  /** Files/snippets the user explicitly attached from the UI, in addition to any @references typed in the prompt. */
  attachments?: WorkspaceContextAttachment[]
}

interface ParsedPrompt {
  explicitPaths: string[]
  wantsWorkspaceSearch: boolean
}

export function parsePromptReferences(userPrompt: string): ParsedPrompt {
  const explicitPaths: string[] = []
  let wantsWorkspaceSearch = false

  for (const match of userPrompt.matchAll(FILE_REFERENCE_PATTERN)) {
    const reference = match[1]
    if (reference.toLowerCase() === WORKSPACE_TOKEN) {
      wantsWorkspaceSearch = true
      continue
    }
    // "@ someone" in prose, or an email address, isn't a file reference.
    if (!reference.includes('.') && !reference.includes('/')) continue
    explicitPaths.push(reference.replace(/\\/g, '/'))
  }

  return { explicitPaths: [...new Set(explicitPaths)], wantsWorkspaceSearch }
}

function fenceLanguage(relPath: string): string {
  const extension = path.extname(relPath).replace('.', '').toLowerCase()
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
    py: 'python', rb: 'ruby', php: 'php', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin', cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c',
    vue: 'vue', svelte: 'svelte', html: 'html', css: 'css', scss: 'scss',
    json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', sql: 'sql',
    sh: 'bash', bash: 'bash', ps1: 'powershell', md: 'markdown',
  }
  return map[extension] || extension || 'text'
}

function renderBlock(relPath: string, body: string, lineRange?: { start: number; end: number }): string {
  const location = lineRange ? ` (baris ${lineRange.start}-${lineRange.end})` : ''
  return `--- FILE: ${relPath}${location} ---\n\`\`\`${fenceLanguage(relPath)}\n${body}\n\`\`\``
}

/**
 * Builds the code context for one Vibe Coding turn.
 *
 * @param userPrompt What the user typed, `@references` and all.
 * @param targetPath Optional file currently open in the editor.
 */
export async function buildWorkspaceContext(
  userPrompt: string,
  targetPath?: string,
  options: BuildWorkspaceContextOptions = {},
): Promise<WorkspaceContextResult> {
  const manager = getWorkspaceManager()
  const budgetCharacters = config.workspaceContextTokenBudget * CHARS_PER_TOKEN

  const { explicitPaths, wantsWorkspaceSearch } = parsePromptReferences(userPrompt)
  const blocks: WorkspaceContextBlock[] = []
  const renderedSections: string[] = []
  const seenPaths = new Set<string>()
  let usedCharacters = 0
  let budgetExceeded = false

  const remaining = () => budgetCharacters - usedCharacters

  const addSection = (
    relPath: string,
    body: string,
    meta: Omit<WorkspaceContextBlock, 'relPath' | 'characters' | 'truncated'>,
    lineRange?: { start: number; end: number },
  ): void => {
    const available = remaining()
    // Below this there is no room for anything a model could use.
    if (available < 400) {
      budgetExceeded = true
      return
    }

    let content = body
    let truncated = false
    // Leave headroom for the fence, path header and line markers.
    const bodyBudget = available - 200
    if (content.length > bodyBudget) {
      content = `${content.slice(0, bodyBudget)}\n... [dipotong agar muat di context window]`
      truncated = true
      budgetExceeded = true
    }

    const section = renderBlock(relPath, content, lineRange)
    renderedSections.push(section)
    usedCharacters += section.length
    blocks.push({ ...meta, relPath, characters: section.length, truncated })
  }

  // ---- 0. Explicit attachments from the UI (the "+" context picker, or a
  // line range selected in the editor and added as context). A ranged
  // attachment is always included on its own - even for a file already added
  // in full below - since it's what the user specifically pointed at.
  for (const attachment of options.attachments ?? []) {
    const relPath = attachment.relPath.replace(/\\/g, '/')
    const hasRange = typeof attachment.startLine === 'number' && typeof attachment.endLine === 'number'
    if (!hasRange && seenPaths.has(relPath)) continue
    try {
      const file = await manager.readWorkspaceFile(relPath)
      if (hasRange) {
        const lines = file.content.split('\n')
        const start = Math.max(1, attachment.startLine as number)
        const end = Math.min(lines.length, attachment.endLine as number)
        const slice = lines.slice(start - 1, end).join('\n')
        addSection(file.relPath, slice, {
          reason: 'explicit',
          startLine: start,
          endLine: end,
          symbol: null,
          score: null,
        }, { start, end })
      } else {
        seenPaths.add(file.relPath)
        seenPaths.add(relPath)
        addSection(file.relPath, file.truncated ? `${file.content}\n... [file terlalu besar, dipotong]` : file.content, {
          reason: 'explicit',
          startLine: 1,
          endLine: file.lines,
          symbol: null,
          score: null,
        })
      }
    } catch {
      renderedSections.push(`--- FILE: ${relPath} ---\n[tidak ditemukan di workspace]`)
    }
  }

  // ---- 1. Files the user named explicitly: whole file, no vector search.
  for (const reference of explicitPaths) {
    if (seenPaths.has(reference)) continue
    try {
      const file = await manager.readWorkspaceFile(reference)
      seenPaths.add(file.relPath)
      seenPaths.add(reference)
      addSection(file.relPath, file.truncated ? `${file.content}\n... [file terlalu besar, dipotong]` : file.content, {
        reason: 'explicit',
        startLine: 1,
        endLine: file.lines,
        symbol: null,
        score: null,
      })
    } catch {
      // A mistyped @path shouldn't fail the whole turn - the model is told instead.
      renderedSections.push(`--- FILE: ${reference} ---\n[tidak ditemukan di workspace]`)
    }
  }

  // ---- 2. The file open in the editor, when the prompt didn't name one.
  const editorPath = targetPath || options.targetPath
  if (editorPath && !seenPaths.has(editorPath.replace(/\\/g, '/'))) {
    try {
      const file = await manager.readWorkspaceFile(editorPath)
      if (!seenPaths.has(file.relPath)) {
        seenPaths.add(file.relPath)
        addSection(file.relPath, file.content, {
          reason: 'target',
          startLine: 1,
          endLine: file.lines,
          symbol: null,
          score: null,
        })
      }
    } catch {
      // The editor may hold an unsaved or just-deleted file; ignore it.
    }
  }

  // ---- 3. Vector search, for @workspace or a prompt with no explicit target.
  const shouldSearch = wantsWorkspaceSearch || (explicitPaths.length === 0)
  if (shouldSearch && remaining() > 600) {
    const searchText = userPrompt.replace(FILE_REFERENCE_PATTERN, ' ').trim() || userPrompt
    let queryEmbedding: number[] | null = null
    try {
      queryEmbedding = await embed(searchText)
    } catch (error) {
      console.warn('Workspace query embedding failed; skipping code search:', error)
    }

    if (queryEmbedding) {
      const matches = manager.search(
        queryEmbedding,
        config.workspaceMaxChunks,
        config.workspaceMinScore,
        // Don't re-send chunks of a file already included in full above.
        seenPaths,
        // The raw text goes along for keyword blending - see WorkspaceStore.search.
        { queryText: searchText, relativeRatio: config.workspaceRelativeScoreRatio },
      )
      for (const match of matches) {
        if (remaining() < 400) {
          budgetExceeded = true
          break
        }
        addSection(match.relPath, match.content, {
          reason: 'search',
          startLine: match.startLine,
          endLine: match.endLine,
          symbol: match.symbol,
          score: Number(match.score.toFixed(4)),
        }, { start: match.startLine, end: match.endLine })
      }
    }
  }

  const contextText = renderedSections.length
    ? renderedSections.join('\n\n')
    : '[tidak ada file yang relevan ditemukan - minta user menyebut file dengan @path jika perlu]'

  const instruction = options.mode === 'ask' ? ASK_MODE_INSTRUCTION : CODE_MODE_INSTRUCTION
  const systemContent = `${instruction}\n\nCONTEXT KODE RELEVAN:\n${contextText}`

  const messages: ChatMessage[] = [
    { role: 'system', content: systemContent },
    ...(options.history ?? []),
    { role: 'user', content: userPrompt },
  ]

  // The flat rendering the spec describes, kept for the UI's "lihat prompt" panel.
  const promptPreview = [
    `SYSTEM: ${instruction}`,
    `CONTEXT KODE RELEVAN:\n${contextText}`,
    `USER PROMPT: ${userPrompt}`,
  ].join('\n\n')

  return {
    messages,
    promptPreview,
    blocks,
    usedCharacters,
    budgetCharacters,
    budgetExceeded,
  }
}

export const WORKSPACE_SYSTEM_INSTRUCTION = SYSTEM_INSTRUCTION
