import { getSettings } from './api.js'

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
}

export interface AgentChatResult {
  ok: boolean
  message?: AgentMessage
  toolRounds?: number
  retrievedChunks?: number
  error?: string
}

export interface AgentStreamEvent {
  type: 'meta' | 'token' | 'done'
  content?: string
  toolRounds?: number
  retrievedChunks?: number
}

const DEFAULT_AGENT_URL = 'http://127.0.0.1:8787/api'

export function getAgentApiUrl(): string {
  const configured = import.meta.env.VITE_AGENT_SERVER_URL
  return (configured || DEFAULT_AGENT_URL).replace(/\/$/, '')
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${getAgentApiUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) {
    throw new Error(payload.error || `Agent server error ${response.status}`)
  }
  return payload
}

export async function sendMessage(
  message: string,
  history: AgentMessage[],
  model?: string,
  signal?: AbortSignal,
  conversationId?: string,
): Promise<AgentChatResult> {
  const settings = getSettings()
  return requestJson<AgentChatResult>('/chat', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      model: model || settings.agentModel || undefined,
      conversationId,
      messages: [...history, { role: 'user', content: message }],
    }),
  })
}

export async function sendMessageStream(
  message: string,
  history: AgentMessage[],
  model: string | undefined,
  signal: AbortSignal,
  conversationId: string,
  onToken: (content: string) => void,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${getAgentApiUrl()}/chat`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({
        model,
        conversationId,
        stream: true,
        messages: [...history, { role: 'user', content: message }],
      }),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error(`Agent server tidak dapat dihubungi di ${getAgentApiUrl()}. Jalankan agent-server terlebih dahulu.`)
  }
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error || `Agent server error ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      const event = JSON.parse(line) as AgentStreamEvent
      if (event.type === 'token' && event.content) onToken(event.content)
    }
  }
  if (buffer.trim()) {
    const event = JSON.parse(buffer) as AgentStreamEvent
    if (event.type === 'token' && event.content) onToken(event.content)
  }
}

export async function uploadDocument(file: File): Promise<{ ok: boolean; documents: number; chunks: number }> {
  const content = await file.text()
  return requestJson('/ingest', {
    method: 'POST',
    body: JSON.stringify({
      documents: [{ source: file.name, content }],
    }),
  })
}

export async function checkAgentHealth(): Promise<{ ok: boolean; error?: string }> {
  return requestJson('/health', { method: 'GET' })
}
