import { checkEnginePing, getApiUrl } from './api.js'
import {
  getChatHistoryStoragePath,
  setChatHistoryStoragePath as apiSetChatHistoryStoragePath,
  clearChatHistoryStoragePath as apiClearChatHistoryStoragePath,
  listServerConversations,
  saveServerConversation,
  deleteServerConversation,
  listServerFolders,
  saveServerFolders,
} from './api.ts'

// Chat history (conversations + folders) is mediated by the agent-server so
// its folder can be picked with the same server-side folder browser used for
// the memory location - the browser's own File System Access API can't hand
// a real path to a separate process, only a sandboxed handle. When no folder
// is configured, everything falls back to localStorage exactly like before
// this existed.
//
// This module used to also build a second, separate "cross-conversation
// memory" out of this same chat-history folder (global_memory.json +
// semantic search over conversations) and send it to the agent-server on
// every message. That was always redundant with the agent-server's own real
// memory (see memory-core.ts, tied to "Lokasi Penyimpanan Ingatan" - a
// completely separate, independently-configured folder) - and because it was
// scoped to *this* folder, switching the chat-history folder made memory
// look like it "disappeared" even though the real memory never moved. The
// agent-server's memory works regardless of which chat-history folder is
// active, so there is nothing to rebuild here - just don't duplicate it.
let chatHistoryRoot = null

/** Re-check with the agent-server which folder (if any) chat history is stored in. */
export async function refreshChatHistoryStorage() {
  try {
    const info = await getChatHistoryStoragePath()
    chatHistoryRoot = info.isConfigured ? info.chatHistoryRoot : null
  } catch (error) {
    console.warn('Could not reach agent-server for chat history storage info:', error)
    chatHistoryRoot = null
  }
  return chatHistoryRoot
}

export function getChatHistoryRootPath() {
  return chatHistoryRoot
}

export async function setChatHistoryFolder(path) {
  const info = await apiSetChatHistoryStoragePath(path)
  chatHistoryRoot = info.isConfigured ? info.chatHistoryRoot : null
  return info
}

export async function clearChatHistoryFolder() {
  const info = await apiClearChatHistoryStoragePath()
  chatHistoryRoot = null
  return info
}

function isServerStorageActive() {
  return !!chatHistoryRoot
}

export async function getMemoryStatus(model) {
  if (!isServerStorageActive()) {
    return { ready: false, reason: 'storage-not-selected' }
  }
  if (!model) {
    return { ready: false, reason: 'model-not-selected' }
  }

  const ping = await checkEnginePing(getApiUrl())
  if (!ping.online) {
    return { ready: false, reason: 'ollama-offline', ping }
  }

  return { ready: true, ping }
}

export async function loadStoredConversations(model, { requireConnection = false } = {}) {
  if (requireConnection) {
    const status = await getMemoryStatus(model)
    if (!status.ready) return null
  } else if (!isServerStorageActive()) {
    return null
  }

  try {
    const result = await listServerConversations()
    return (result.conversations || [])
      .map((stored) => ({
        id: stored.conversationId,
        title: stored.title || '',
        messages: stored.messages,
        folderId: stored.folderId || null,
        createdAt: stored.createdAt || stored.updatedAt || new Date().toISOString(),
      }))
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
  } catch (error) {
    console.error('Failed to load conversations from agent-server:', error)
    return null
  }
}

export async function loadStoredFolders(model) {
  if (!isServerStorageActive()) return null
  try {
    const result = await listServerFolders()
    return result.folders || []
  } catch (error) {
    console.error('Failed to load folders from agent-server:', error)
    return null
  }
}

export async function saveStoredFolders(folders, model) {
  if (!isServerStorageActive()) return false
  try {
    await saveServerFolders(folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId || null,
      isExpanded: folder.isExpanded !== false,
      createdAt: folder.createdAt,
    })))
    return true
  } catch (error) {
    console.error('Failed to save folders to agent-server:', error)
    return false
  }
}

export async function saveConversation(conversation, model) {
  if (!conversation?.id) throw new Error('Conversation ID is missing')
  // Not configured: App.vue's own saveState() already persists the full
  // conversation list to localStorage, so there is nothing more to do here.
  if (!isServerStorageActive()) return true

  try {
    await saveServerConversation({
      conversationId: conversation.id,
      title: conversation.title || '',
      folderId: conversation.folderId || null,
      createdAt: conversation.createdAt || new Date().toISOString(),
      messages: conversation.messages || [],
    })
    return true
  } catch (error) {
    console.error('Failed to save conversation to agent-server:', error)
    return false
  }
}

export async function deleteConversation(conversation, model) {
  if (!conversation?.id) return false
  if (!isServerStorageActive()) return true

  try {
    await deleteServerConversation(conversation.id)
    return true
  } catch (error) {
    console.error('Failed to delete conversation from agent-server:', error)
    return false
  }
}
