import { config } from './config.js'
import type { ChatMessage, OllamaChatResponse, ToolDefinition } from './types.js'

interface OllamaGenerateEmbeddingResponse {
  embedding?: number[]
  embeddings?: number[][]
}

export class OllamaError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'OllamaError'
  }
}

async function parseError(response: Response): Promise<never> {
  const body = await response.text().catch(() => '')
  throw new OllamaError(`Ollama request failed (${response.status}): ${body || response.statusText}`, response.status)
}

export async function embed(text: string): Promise<number[]> {
  const response = await fetch(`${config.ollamaBaseUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.embedModel, prompt: text }),
  })
  if (!response.ok) await parseError(response)
  const payload = await response.json() as OllamaGenerateEmbeddingResponse
  const vector = payload.embedding ?? payload.embeddings?.[0]
  if (!vector?.length) throw new OllamaError('Ollama returned an empty embedding')
  return vector
}

export async function chat(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model = config.chatModel,
): Promise<OllamaChatResponse> {
  const response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      tools: tools.length ? tools : undefined,
      stream: false,
    }),
  })
  if (!response.ok) await parseError(response)
  const payload = await response.json() as OllamaChatResponse
  if (!payload.message) throw new OllamaError('Ollama returned no assistant message')
  return payload
}

export async function chatStream(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model: string,
  onToken: (content: string) => void,
): Promise<OllamaChatResponse> {
  const response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, tools: tools.length ? tools : undefined, stream: true }),
  })
  if (!response.ok) await parseError(response)
  if (!response.body) throw new OllamaError('Ollama returned no stream body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let done = false
  const toolCalls: NonNullable<ChatMessage['tool_calls']> = []

  const consume = (line: string) => {
    if (!line.trim()) return
    const payload = JSON.parse(line) as OllamaChatResponse
    const chunk = payload.message
    if (chunk?.content) {
      content += chunk.content
      onToken(chunk.content)
    }
    if (chunk?.tool_calls?.length) toolCalls.push(...chunk.tool_calls)
    done = payload.done || done
  }

  while (!done) {
    const result = await reader.read()
    if (result.done) break
    buffer += decoder.decode(result.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) consume(line)
  }
  if (buffer.trim()) consume(buffer)
  return {
    done: true,
    message: {
      role: 'assistant',
      content,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
  }
}

export async function ping(): Promise<{ version: string }> {
  const response = await fetch(`${config.ollamaBaseUrl}/api/version`)
  if (!response.ok) await parseError(response)
  return await response.json() as { version: string }
}
