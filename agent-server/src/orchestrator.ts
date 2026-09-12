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
Use retrieved context or memory only when relevant to answer the user's explicit question.
This is a personal, single-user local assistant: when Session Summary, Structured Facts, or Relevant Memory show that the user has already told you something about themselves (their name, preferences, other facts), recalling and stating it back when asked is expected and wanted - it is not a privacy violation, so never refuse on privacy grounds to repeat information the user themselves gave you. If you don't actually know a value, just say so plainly; never answer with an unfilled placeholder like "[nama Anda]" or "[your name]" in place of a real value. When memory shows the user directly stated a fact, treat it as reliable and use it confidently; if it also shows a past assistant reply that conflicts with what the user said, the user's own words are always the correct ones to trust.`

interface PreparedContext {
  messages: ChatMessage[]
  retrievedChunks: number
}

// Rough but stable enough for budgeting: mixed prose averages ~4 chars/token.
const CHARS_PER_TOKEN = 4
// Everything injected around the conversation (documents + recalled memory)
// is capped at this share of the context window, so the conversation itself
// always keeps the majority. Without a cap, retrieval alone could exceed the
// whole window and Ollama would silently drop the actual conversation.
const INJECTED_CONTEXT_SHARE = 0.3

function budgetFor(numCtx: number | undefined): number {
  const window = numCtx && numCtx > 0 ? numCtx : config.numCtxFallback
  return Math.floor(window * INJECTED_CONTEXT_SHARE) * CHARS_PER_TOKEN
}

/** Takes whole items in order until the character budget runs out. */
function fitToBudget(items: string[], budget: number): string[] {
  const kept: string[] = []
  let used = 0
  for (const item of items) {
    if (used + item.length > budget) break
    kept.push(item)
    used += item.length
  }
  return kept
}

// Share of the window left free for the model's own reply.
const RESPONSE_RESERVE_SHARE = 0.25
// The opening messages are where the user usually establishes the premise
// ("the pipe is 60km"), so they're the worst thing to lose.
const KEEP_OLDEST_MESSAGES = 4

/**
 * Keeps a long conversation inside the context window without losing the
 * premise. Left to itself, Ollama drops the *oldest* tokens when a prompt
 * overflows - which is exactly where the user stated the facts the whole
 * conversation depends on, so the model would keep "forgetting" things that
 * had been repeated several times. This instead keeps the opening messages
 * and as many recent ones as fit, drops the middle, and says so explicitly
 * rather than letting the gap pass silently.
 */
function trimHistoryToBudget(input: ChatMessage[], budgetChars: number): ChatMessage[] {
  const total = input.reduce((sum, message) => sum + message.content.length, 0)
  if (total <= budgetChars || input.length <= KEEP_OLDEST_MESSAGES + 1) return input

  const head = input.slice(0, KEEP_OLDEST_MESSAGES)
  let used = head.reduce((sum, message) => sum + message.content.length, 0)

  const tail: ChatMessage[] = []
  for (let index = input.length - 1; index >= KEEP_OLDEST_MESSAGES; index -= 1) {
    const message = input[index]
    // The newest message is the actual question - always keep it, even if it
    // alone blows the budget.
    const isNewest = index === input.length - 1
    if (!isNewest && used + message.content.length > budgetChars) break
    tail.unshift(message)
    used += message.content.length
  }

  const dropped = input.length - head.length - tail.length
  if (dropped <= 0) return input

  return [
    ...head,
    {
      role: 'system',
      content: `[${dropped} older message(s) from the middle of this conversation were omitted to fit the context window. The opening messages above and the recent ones below are intact. If you need something from the omitted part, ask the user instead of guessing.]`,
    },
    ...tail,
  ]
}

/**
 * Surfaces the user's Yes/No feedback (see MessageBubble.vue) on a retrieved
 * past exchange directly in the model's context, so a reply the user marked
 * unhelpful isn't quietly repeated for a similar question later.
 */
function describeRating(rating: unknown): string {
  if (rating === 'good') return ' [User marked this reply as helpful]'
  if (rating === 'bad') return ' [User marked this reply as NOT helpful - avoid repeating this approach]'
  return ''
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
  private async prepareContext(input: ChatMessage[], conversationId: string, numCtx?: number): Promise<PreparedContext> {
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

    // Split the injection budget between documents and recalled memory, so
    // neither can grow big enough to squeeze the conversation out of the
    // context window (which is what made the model "forget" things the user
    // had said only a few messages earlier).
    const budget = budgetFor(numCtx)
    const documentBudget = Math.floor(budget / 2)

    const retrievedParts = fitToBudget(
      retrieved.map((item) => `[${item.source}]\n${item.content}`),
      documentBudget,
    )
    const context = retrievedParts.length
      ? `Retrieved local context:\n${retrievedParts.join('\n\n')}`
      : ''

    const memoryParts = fitToBudget(
      memoryResults.map((item) => `[${item.timestamp}] ${item.sender}: ${item.message}${describeRating(item.metadata?.rating)}`),
      budget - (context.length > 0 ? context.length : 0),
    )

    // Note: the session's rolling summary is deliberately NOT injected. It is a
    // verbatim copy of the most recent messages of this same conversation,
    // which the client already sends in full as the message history - so
    // including it just duplicated thousands of tokens of the conversation
    // against itself and pushed the real history out of the window.
    const memoryContext = [
      memoryState.facts.length ? `Structured Facts:\n${memoryState.facts.map((fact) => `${fact.key}: ${fact.value}`).join('\n')}` : '',
      memoryParts.length ? `Relevant Memory:\n${memoryParts.join('\n')}` : '',
    ].filter(Boolean).join('\n\n')

    // Whatever the window has left after the system prompt, the injected
    // context, and room for the reply is what the conversation itself gets.
    const window = numCtx && numCtx > 0 ? numCtx : config.numCtxFallback
    const overheadChars = agentInstruction.length + context.length + memoryContext.length
    const historyBudget = Math.max(
      window * (1 - RESPONSE_RESERVE_SHARE) * CHARS_PER_TOKEN - overheadChars,
      // Never squeeze the conversation to nothing, even with a tiny window.
      window * CHARS_PER_TOKEN * 0.25,
    )

    const messages: ChatMessage[] = [
      { role: 'system', content: agentInstruction },
      ...(context ? [{ role: 'system' as const, content: context }] : []),
      ...(memoryContext ? [{ role: 'system' as const, content: memoryContext }] : []),
      ...trimHistoryToBudget(input, historyBudget),
    ]

    // Report what was actually injected, not what was fetched - the budget
    // above may well have dropped some of it.
    return { messages, retrievedChunks: retrievedParts.length }
  }

  async run(
    input: ChatMessage[],
    model = config.chatModel,
    conversationId = 'default',
    options?: ChatOptions,
    ollamaBaseUrl?: string,
    signal?: AbortSignal,
  ): Promise<AgentResponse> {
    const { messages, retrievedChunks } = await this.prepareContext(input, conversationId, options?.num_ctx)

    for (let round = 0; round < config.maxToolRounds; round += 1) {
      signal?.throwIfAborted()
      const response = await chat(messages, toolDefinitions, model, options, ollamaBaseUrl, signal)
      messages.push(response.message)
      const toolCalls = response.message.tool_calls ?? []
      if (!toolCalls.length) {
        const appended = await this.memory.appendMessage('assistant', response.message.content, { conversationId, provider: 'agent-server' })
        return { message: response.message, toolRounds: round, retrievedChunks, memoryId: appended.id }
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
    signal?: AbortSignal,
  ): Promise<AgentResponse> {
    const { messages, retrievedChunks } = await this.prepareContext(input, conversationId, options?.num_ctx)

    for (let round = 0; round < config.maxToolRounds; round += 1) {
      signal?.throwIfAborted()
      const response = await chatStream(messages, toolDefinitions, model, onToken, options, ollamaBaseUrl, signal)
      messages.push(response.message)
      const toolCalls = response.message.tool_calls ?? []
      if (!toolCalls.length) {
        const appended = await this.memory.appendMessage('assistant', response.message.content, { conversationId, provider: 'agent-server' })
        return { message: response.message, toolRounds: round, retrievedChunks, memoryId: appended.id }
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
