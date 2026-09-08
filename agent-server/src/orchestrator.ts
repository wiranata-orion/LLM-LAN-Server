import { config } from './config.js'
import { chat, chatStream } from './ollama.js'
import { Retriever } from './retriever.js'
import { executeTool } from './tools/executor.js'
import { toolDefinitions } from './tools/registry.js'
import type { MemoryCore } from './memory-core.js'
import type { AgentResponse, ChatMessage } from './types.js'

const agentInstruction = `You are a local agent. Use retrieved context only when relevant and clearly distinguish it from the user's current request. Use tools when a tool is appropriate. After tool results are returned, answer the user directly and concisely. Never expose internal orchestration details.`

export class AgentOrchestrator {
  constructor(private readonly retriever: Retriever, private readonly memory: MemoryCore) {}

  async run(input: ChatMessage[], model = config.chatModel, conversationId = 'default'): Promise<AgentResponse> {
    const latestUserMessage = [...input].reverse().find((message) => message.role === 'user')
    if (latestUserMessage) {
      await this.memory.appendMessage('user', latestUserMessage.content, { conversationId, provider: 'agent-server' })
    }
    const memoryResults = latestUserMessage ? await this.memory.search(latestUserMessage.content) : []
    const retrieved = latestUserMessage ? await this.retriever.search(latestUserMessage.content) : []
    const context = retrieved.length
      ? `Retrieved local context:\n${retrieved.map((item) => `[${item.source}]\n${item.content}`).join('\n\n')}`
      : ''
    const memoryContext = memoryResults.length
      ? `Long-term conversation memory:\n${memoryResults.map((item) => `[${item.timestamp}] ${item.sender}: ${item.message}`).join('\n')}`
      : ''

    const messages: ChatMessage[] = [
      { role: 'system', content: agentInstruction },
      ...(context ? [{ role: 'system' as const, content: context }] : []),
      ...(memoryContext ? [{ role: 'system' as const, content: memoryContext }] : []),
      ...input,
    ]

    for (let round = 0; round < config.maxToolRounds; round += 1) {
      const response = await chat(messages, toolDefinitions, model)
      messages.push(response.message)
      const toolCalls = response.message.tool_calls ?? []
      if (!toolCalls.length) {
        await this.memory.appendMessage('assistant', response.message.content, { conversationId, provider: 'agent-server' })
        return { message: response.message, toolRounds: round, retrievedChunks: retrieved.length }
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
  ): Promise<AgentResponse> {
    const latestUserMessage = [...input].reverse().find((message) => message.role === 'user')
    if (latestUserMessage) {
      await this.memory.appendMessage('user', latestUserMessage.content, { conversationId, provider: 'agent-server' })
    }
    const memoryResults = latestUserMessage ? await this.memory.search(latestUserMessage.content) : []
    const retrieved = latestUserMessage ? await this.retriever.search(latestUserMessage.content) : []
    const context = retrieved.length
      ? `Retrieved local context:\n${retrieved.map((item) => `[${item.source}]\n${item.content}`).join('\n\n')}`
      : ''
    const memoryContext = memoryResults.length
      ? `Long-term conversation memory:\n${memoryResults.map((item) => `[${item.timestamp}] ${item.sender}: ${item.message}`).join('\n')}`
      : ''
    const messages: ChatMessage[] = [
      { role: 'system', content: agentInstruction },
      ...(context ? [{ role: 'system' as const, content: context }] : []),
      ...(memoryContext ? [{ role: 'system' as const, content: memoryContext }] : []),
      ...input,
    ]

    for (let round = 0; round < config.maxToolRounds; round += 1) {
      const response = await chatStream(messages, toolDefinitions, model, onToken)
      messages.push(response.message)
      const toolCalls = response.message.tool_calls ?? []
      if (!toolCalls.length) {
        await this.memory.appendMessage('assistant', response.message.content, { conversationId, provider: 'agent-server' })
        return { message: response.message, toolRounds: round, retrievedChunks: retrieved.length }
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
