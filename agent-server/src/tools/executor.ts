import type { ToolCall } from '../types.js'
import { fetchAndExtract } from '../web-fetch.js'

function calculate(expression: string): number {
  if (!/^[0-9+\-*/%().\s]+$/.test(expression)) throw new Error('Only arithmetic characters are allowed')
  const result = Function(`"use strict"; return (${expression})`)()
  if (typeof result !== 'number' || !Number.isFinite(result)) throw new Error('Expression did not produce a finite number')
  return result
}

function currentTime(timezone: string): { timezone: string; iso: string; formatted: string } {
  try {
    const now = new Date()
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'long',
    }).format(now)
    return { timezone, iso: now.toISOString(), formatted }
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`)
  }
}

/**
 * @param signal Forwarded to fetch_url so a client disconnect (Stop button) also cancels an in-flight page fetch, same as it already cancels the underlying Ollama request - see orchestrator.ts.
 * @param webFetchOptions Settings > Keamanan & Web, forwarded per request - see web-fetch.ts.
 */
export async function executeTool(
  call: ToolCall,
  signal?: AbortSignal,
  webFetchOptions?: { timeoutMs?: number; userAgent?: string },
): Promise<string> {
  const args = call.function.arguments
  switch (call.function.name) {
    case 'calculator':
      return JSON.stringify({ result: calculate(String(args.expression ?? '')) })
    case 'current_time':
      return JSON.stringify(currentTime(String(args.timezone ?? 'UTC')))
    case 'fetch_url':
      return JSON.stringify(await fetchAndExtract(String(args.url ?? ''), signal, webFetchOptions))
    default:
      throw new Error(`Tool is not registered: ${call.function.name}`)
  }
}
