import { config } from './config.js'
import type { ChatMessage, ChatOptions, OllamaChatResponse, ToolDefinition } from './types.js'

interface OllamaGenerateEmbeddingResponse {
  embedding?: number[]
  embeddings?: number[][]
}

interface OllamaShowResponse {
  capabilities?: string[]
}

const toolSupportCache = new Map<string, boolean>()

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

async function supportsTools(model: string, baseUrl: string): Promise<boolean> {
  const cacheKey = `${baseUrl}::${model}`
  const cached = toolSupportCache.get(cacheKey)
  if (cached !== undefined) return cached

  try {
    const response = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    })
    if (!response.ok) return false
    const payload = await response.json() as OllamaShowResponse
    const supported = payload.capabilities?.includes('tools') ?? false
    toolSupportCache.set(cacheKey, supported)
    return supported
  } catch {
    return false
  }
}

async function requestChat(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model: string,
  stream: boolean,
  options?: ChatOptions,
  baseUrl: string = config.ollamaBaseUrl,
): Promise<Response> {
  const canUseTools = tools.length > 0 && await supportsTools(model, baseUrl)
  const hasOptions = options && Object.values(options).some((value) => value !== undefined && value !== null && value !== '')
  const createRequest = (includeTools: boolean) => fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      ...(includeTools ? { tools } : {}),
      ...(hasOptions ? { options } : {}),
      stream,
    }),
  })

  let response = await createRequest(canUseTools)
  if (!response.ok && canUseTools && response.status === 400) {
    const body = await response.clone().text().catch(() => '')
    if (/tools?|function calling|does not support/i.test(body)) {
      toolSupportCache.set(`${baseUrl}::${model}`, false)
      response = await createRequest(false)
    }
  }
  return response
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
  options?: ChatOptions,
  baseUrl?: string,
): Promise<OllamaChatResponse> {
  const response = await requestChat(messages, tools, model, false, options, baseUrl)
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
  options?: ChatOptions,
  baseUrl?: string,
): Promise<OllamaChatResponse> {
  const response = await requestChat(messages, tools, model, true, options, baseUrl)
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
