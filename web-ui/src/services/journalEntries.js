/**
 * Automated Daily Standup / Journaling Assistant (#22). Purely a local log -
 * unlike pinnedNotes.js's notes (which reference a conversation), a journal
 * entry is standalone content the user compiled themselves, so it has
 * nothing to go stale against and no conversation to be cleaned up when.
 */
const STORAGE_KEY = 'xufruz-journal-entries'

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Storage full/unavailable - the entry just won't survive a reload.
  }
}

/** Newest first. */
export function getJournalEntries() {
  return readAll().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

/**
 * @param {{ completed: string, blockers: string, nextSteps: string }} answers
 * @returns {{ id: string, createdAt: string, answers: object, markdown: string }}
 */
export function addJournalEntry(answers) {
  const createdAt = new Date().toISOString()
  const entry = { id: `journal-${Date.now()}`, createdAt, answers, markdown: compileMarkdown(answers, createdAt) }
  const entries = readAll()
  entries.push(entry)
  writeAll(entries)
  return entry
}

export function deleteJournalEntry(id) {
  writeAll(readAll().filter((entry) => entry.id !== id))
}

/** Exposed separately from addJournalEntry so the UI can preview the compiled markdown before saving. */
export function compileMarkdown({ completed, blockers, nextSteps }, isoDate = new Date().toISOString()) {
  const date = new Date(isoDate).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
  return [
    `## Standup — ${date}`,
    '',
    '### Yang sudah dikerjakan',
    completed.trim() || '-',
    '',
    '### Blocker / kendala',
    blockers.trim() || 'Tidak ada.',
    '',
    '### Rencana selanjutnya',
    nextSteps.trim() || '-',
  ].join('\n')
}
