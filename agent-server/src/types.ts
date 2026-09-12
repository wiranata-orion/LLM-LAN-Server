export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: Role
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required: string[]
    }
  }
}

export interface DocumentInput {
  id?: string
  source: string
  content: string
  metadata?: Record<string, string | number | boolean>
}

export interface VectorRecord {
  id: string
  source: string
  content: string
  embedding: number[]
  metadata: Record<string, string | number | boolean>
  createdAt: string
}

export interface OllamaChatResponse {
  message: ChatMessage
  done: boolean
}

export interface ChatOptions {
  temperature?: number
  num_ctx?: number
  num_predict?: number
}

export interface AgentResponse {
  message: ChatMessage
  toolRounds: number
  retrievedChunks: number
  // The memory-core record id for the assistant's own reply, so the client can
  // later rate this specific exchange (see MemoryCore.rateMessage).
  memoryId?: string
}
