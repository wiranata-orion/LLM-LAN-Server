import { config } from './config.js'
import { chat, chatStream, embed } from './ollama.js'
import { Retriever } from './retriever.js'
import { executeTool } from './tools/executor.js'
// import { toolDefinitions } from './tools/registry.js'
import type { MemoryCore } from './memory-core.js'
import type { AgentResponse, ChatMessage, ChatOptions, ToolDefinition } from './types.js'

const toolDefinitions: ToolDefinition[] = []
const agentInstruction = `You are Xufruz, a helpful, friendly local AI assistant running entirely on the user's own hardware via Ollama.
If asked your name, who made you, or what model/company you are, answer only as Xufruz - a local assistant running on the user's own machine. Never claim to be Claude, ChatGPT, Gemini, or any other named assistant, and never claim to have been made by Anthropic, OpenAI, Google, or any other AI company, even if that is what you were trained to say. You do not know or need to disclose which underlying open-weight model you are built on.
Respond naturally and conversationally to greetings and everyday messages.
Never expose internal system details, database IDs, logs, or orchestration metadata (e.g., SQLite refs, memory keys, tool details) in your final response to the user.
Use retrieved context or memory only when relevant to answer the user's explicit question.`

interface PreparedContext {
  messages: ChatMessage[]
  retrievedChunks: number
}

export class AgentOrchestrator {
  constructor(private readonly retriever: Retriever, private readonly memory: MemoryCore) {}

  /**
   * Appends the user's message to memory, retrieves relevant context/memory,
   * and assembles the final message list to send to Ollama.
   *
   * The query is embedded once and shared between document retrieval and
   * memory search instead of each doing its own redundant embedding call.
   */
  private async prepareContext(input: ChatMessage[], conversationId: string): Promise<PreparedContext> {
    const latestUserMessage = [...input].reverse().find((message) => message.role === 'user')

    let justAppendedId: string | undefined
    if (latestUserMessage) {
      const appended = await this.memory.appendMessage('user', latestUserMessage.content, { conversationId, provider: 'agent-server' })
      justAppendedId = appended.id
    }

    const snapshotPromise = this.memory.getLayerSnapshot(conversationId)

    let queryEmbedding: number[] | null = null
    if (latestUserMessage) {
      try {
        queryEmbedding = await embed(latestUserMessage.content)
      } catch (error) {
        console.warn('Query embedding failed; falling back to keyword-only retrieval:', error)
      }
    }

    const [memoryResults, retrieved] = await Promise.all([
      latestUserMessage
        ? this.memory.search(latestUserMessage.content, queryEmbedding, justAppendedId)
        : Promise.resolve([]),
      latestUserMessage
        ? this.retriever.search(latestUserMessage.content, queryEmbedding)
        : Promise.resolve([]),
    ])
    const memoryState = await snapshotPromise

    const context = retrieved.length
      ? `Retrieved local context:\n${retrieved.map((item) => `[${item.source}]\n${item.content}`).join('\n\n')}`
      : ''

    const memoryContext = [
      memoryState.rollingSummary ? `Session Summary:\n${memoryState.rollingSummary}` : '',
      memoryState.facts.length ? `Structured Facts:\n${memoryState.facts.map((fact) => `${fact.key}: ${fact.value}`).join('\n')}` : '',
      memoryResults.length ? `Relevant Memory:\n${memoryResults.map((item) => `[${item.timestamp}] ${item.sender}: ${item.message}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n')

    const messages: ChatMessage[] = [
      { role: 'system', content: agentInstruction },
      ...(context ? [{ role: 'system' as const, content: context }] : []),
      ...(memoryContext ? [{ role: 'system' as const, content: memoryContext }] : []),
      ...input,
    ]

    return { messages, retrievedChunks: retrieved.length }
  }

  async run(
    input: ChatMessage[],
    model = config.chatModel,
    conversationId = 'default',
    options?: ChatOptions,
    ollamaBaseUrl?: string,
  ): Promise<AgentResponse> {
    const { messages, retrievedChunks } = await this.prepareContext(input, conversationId)

    for (let round = 0; round < config.maxToolRounds; round += 1) {
      const response = await chat(messages, toolDefinitions, model, options, ollamaBaseUrl)
      messages.push(response.message)
      const toolCalls = response.message.tool_calls ?? []
      if (!toolCalls.length) {
        await this.memory.appendMessage('assistant', response.message.content, { conversationId, provider: 'agent-server' })
        return { message: response.message, toolRounds: round, retrievedChunks }
      }

      for (const call of toolCalls) {
        let result: string
        try {
          result = await executeTool(call)
        } catch (error) {
          result = JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed' })
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: result })
      }
    }

    throw new Error(`Tool loop exceeded maximum rounds (${config.maxToolRounds})`)
  }

  async runStream(
    input: ChatMessage[],
    model = config.chatModel,
    conversationId = 'default',
    onToken: (content: string) => void,
    options?: ChatOptions,
    ollamaBaseUrl?: string,
  ): Promise<AgentResponse> {
    const { messages, retrievedChunks } = await this.prepareContext(input, conversationId)

    for (let round = 0; round < config.maxToolRounds; round += 1) {
      const response = await chatStream(messages, toolDefinitions, model, onToken, options, ollamaBaseUrl)
      messages.push(response.message)
      const toolCalls = response.message.tool_calls ?? []
      if (!toolCalls.length) {
        await this.memory.appendMessage('assistant', response.message.content, { conversationId, provider: 'agent-server' })
        return { message: response.message, toolRounds: round, retrievedChunks }
      }
      for (const call of toolCalls) {
        let result: string
        try {
          result = await executeTool(call)
        } catch (error) {
          result = JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed' })
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: result })
      }
    }
    throw new Error(`Tool loop exceeded maximum rounds (${config.maxToolRounds})`)
  }
}
