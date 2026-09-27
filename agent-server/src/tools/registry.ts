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
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch a public web page and return its title and main readable text (HTML tags, scripts, and navigation clutter already stripped out), for answering questions about a specific link the user provided or referenced. Only works for public http/https URLs, not local/private addresses.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The full http:// or https:// URL to fetch' } },
        required: ['url'],
      },
    },
  },
]
