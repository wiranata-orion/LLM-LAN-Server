import type { ToolCall } from '../types.js'

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

export async function executeTool(call: ToolCall): Promise<string> {
  const args = call.function.arguments
  switch (call.function.name) {
    case 'calculator':
      return JSON.stringify({ result: calculate(String(args.expression ?? '')) })
    case 'current_time':
      return JSON.stringify(currentTime(String(args.timezone ?? 'UTC')))
    default:
      throw new Error(`Tool is not registered: ${call.function.name}`)
  }
}
