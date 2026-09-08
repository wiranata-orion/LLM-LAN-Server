import type { ToolDefinition } from '../types.js'

export const toolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'calculator',
      description: 'Evaluate a basic arithmetic expression using numbers and + - * / % parentheses.',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: 'Arithmetic expression, for example (12 + 8) / 2' } },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'current_time',
      description: 'Return the current ISO timestamp for a requested IANA timezone.',
      parameters: {
        type: 'object',
        properties: { timezone: { type: 'string', description: 'IANA timezone such as Asia/Jakarta' } },
        required: ['timezone'],
      },
    },
  },
]
