/**
 * Smart Context Bookmark / Highlight Pinning (#24). Deliberately its own
 * localStorage key rather than living inside conversation objects: a pinned
 * note needs to survive deleting the conversation it came from (that's the
 * whole point of "pull the important bit out before it gets buried/removed"),
 * so it can't be stored as part of that conversation's own persisted state.
 */
const STORAGE_KEY = 'xufruz-pinned-notes'

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(notes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes))
  } catch {
    // Storage full or unavailable (private window, quota) - the note just
    // won't persist across reloads; nothing else in this session depends on it.
  }
}

/** Newest first. */
export function getPinnedNotes() {
  return readAll().sort((a, b) => new Date(b.pinnedAt) - new Date(a.pinnedAt))
}

export function isNotePinned(conversationId, content) {
  return readAll().some((note) => note.conversationId === conversationId && note.content === content)
}

/** @returns {object} the created note, or null if this exact message from this conversation is already pinned. */
export function pinNote({ conversationId, conversationTitle, content }) {
  if (isNotePinned(conversationId, content)) return null
  const notes = readAll()
  const note = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId,
    conversationTitle: conversationTitle || 'Tanpa judul',
    content,
    pinnedAt: new Date().toISOString(),
  }
  notes.push(note)
  writeAll(notes)
  return note
}

export function unpinNote(id) {
  writeAll(readAll().filter((note) => note.id !== id))
}

/** Removes every pinned note that came from a conversation - called when that conversation itself is deleted. */
export function unpinAllFromConversation(conversationId) {
  writeAll(readAll().filter((note) => note.conversationId !== conversationId))
}
