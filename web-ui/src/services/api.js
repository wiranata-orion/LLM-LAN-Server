import axios from 'axios'

const DEFAULT_API_URL = 'http://localhost:11434'

function getSettings() {
  try {
    const saved = localStorage.getItem('llm-settings')
    if (saved) return JSON.parse(saved)
  } catch (e) {
    // ignore
  }
  return {}
}

function getApiUrl() {
  const settings = getSettings()
  return settings.apiUrl || DEFAULT_API_URL
}

/**
 * Fetch available models from the Ollama API
 */
export async function getModels() {
  const url = getApiUrl()
  try {
    const res = await axios.get(`${url}/api/tags`)
    return res.data.models || []
  } catch (err) {
    console.error('Failed to fetch models:', err)
    return []
  }
}

/**
 * Send a chat message with streaming support.
 * Uses fetch + ReadableStream for real-time token streaming.
 *
 * @param {Object} params
 * @param {string} params.model - Model name (e.g. "qwen2.5:7b")
 * @param {Array} params.messages - Array of {role, content} messages
 * @param {function} params.onToken - Callback fired for each token chunk
 * @param {function} params.onDone - Callback fired when generation completes
 * @param {function} params.onError - Callback fired on error
 * @param {AbortSignal} params.signal - AbortController signal
 */
export async function sendMessageStream({ model, messages, onToken, onDone, onError, signal }) {
  const url = getApiUrl()
  const settings = getSettings()

  const body = {
    model: model,
    messages: messages,
    stream: true,
    options: {},
  }

  if (settings.temperature !== undefined && settings.temperature !== '') {
    body.options.temperature = parseFloat(settings.temperature)
  }
  if (settings.maxTokens !== undefined && settings.maxTokens !== '') {
    body.options.num_predict = parseInt(settings.maxTokens)
  }

  try {
    const response = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`API error ${response.status}: ${text}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const json = JSON.parse(line)
          if (json.message?.content) {
            onToken(json.message.content)
          }
          if (json.done) {
            onDone?.(json)
            return
          }
        } catch (e) {
          // skip malformed JSON lines
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const json = JSON.parse(buffer)
        if (json.message?.content) {
          onToken(json.message.content)
        }
        if (json.done) {
          onDone?.(json)
          return
        }
      } catch (e) {
        // ignore
      }
    }

    onDone?.({})
  } catch (err) {
    if (err.name === 'AbortError') {
      onDone?.({ aborted: true })
    } else {
      onError?.(err)
    }
  }
}
