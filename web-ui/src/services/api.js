import axios from 'axios'

export const DEFAULT_SETTINGS = {
  activeEngine: 'laptop', // 'pc' | 'laptop'
  pcUrl: 'http://192.168.1.50:11434',
  laptopUrl: 'http://localhost:11434',
  autoFallback: true,
  theme: 'xufruz', // 'xufruz' | 'cyberpunk' | 'oled' | 'light' | 'grey' | 'dark'
  numCtx: 2048, // fallback default
  numCtxLaptop: 2048, // Laptop (Local)
  numCtxPc: 4096,     // PC (Server)
  temperature: 0.7,
  maxTokens: '',
  storageDirName: '',
}

export function getSettings() {
  try {
    const saved = localStorage.getItem('llm-settings')
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) }
    }
  } catch (e) {
    // ignore
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettingsToStorage(newSettings) {
  try {
    const current = getSettings()
    const merged = { ...current, ...newSettings }
    localStorage.setItem('llm-settings', JSON.stringify(merged))
    return merged
  } catch (e) {
    return newSettings
  }
}

export function getApiUrl() {
  const settings = getSettings()
  if (settings.activeEngine === 'pc') {
    return (settings.pcUrl || '').replace(/\/+$/, '')
  }
  return (settings.laptopUrl || DEFAULT_SETTINGS.laptopUrl).replace(/\/+$/, '')
}

/**
 * Check ping and health of an engine URL
 * @param {string} url
 * @returns {Promise<{online: boolean, ms?: number, version?: string, error?: string}>}
 */
export async function checkEnginePing(url) {
  if (!url) return { online: false, error: 'URL kosong' }
  const cleanUrl = url.replace(/\/+$/, '')
  const start = performance.now()
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2500)
    const res = await fetch(`${cleanUrl}/api/version`, {
      method: 'GET',
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    const latency = Math.round(performance.now() - start)
    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      return { online: true, ms: latency, version: data.version || 'OK' }
    }
    return { online: false, error: `HTTP ${res.status}` }
  } catch (err) {
    return { online: false, error: err.name === 'AbortError' ? 'Timeout (2.5s)' : 'Offline' }
  }
}

/**
 * Fetch available models from the active Ollama engine
 */
export async function getModels(isFallbackRetry = false) {
  const settings = getSettings()
  const url = getApiUrl()
  try {
    const res = await axios.get(`${url}/api/tags`, { timeout: 3500 })
    return res.data.models || []
  } catch (err) {
    console.error(`Failed to fetch models from ${url}:`, err)
    if (settings.activeEngine === 'pc' && settings.autoFallback !== false && !isFallbackRetry) {
      console.warn('PC Server unreachable for getModels. Auto-falling back to Laptop...')
      settings.activeEngine = 'laptop'
      saveSettingsToStorage(settings)
      window.dispatchEvent(
        new CustomEvent('engine-fallback', {
          detail: {
            from: 'PC Server',
            to: 'Laptop',
            message: 'Koneksi PC Server terputus. Mengambil model dari Laptop.',
          },
        })
      )
      return getModels(true)
    }
    return []
  }
}

/**
 * Send a chat message with streaming support.
 * Supports auto-fallback from PC Server to Laptop on connection failure.
 */
export async function sendMessageStream({
  model,
  messages,
  onToken,
  onDone,
  onError,
  signal,
  isFallbackRetry = false,
}) {
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

  const activeNumCtx = settings.activeEngine === 'pc'
    ? (settings.numCtxPc || settings.numCtx || 4096)
    : (settings.numCtxLaptop || settings.numCtx || 2048)

  if (activeNumCtx !== undefined && activeNumCtx !== '') {
    body.options.num_ctx = parseInt(activeNumCtx)
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

    try {
      while (true) {
        // Check abort before each read
        if (signal && signal.aborted) {
          await reader.cancel()
          onDone?.({ aborted: true })
          return
        }

        const { done, value } = await reader.read()
        if (done) break

        // Check abort after read returns
        if (signal && signal.aborted) {
          await reader.cancel()
          onDone?.({ aborted: true })
          return
        }

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
    } catch (readErr) {
      if (readErr.name === 'AbortError' || (signal && signal.aborted)) {
        onDone?.({ aborted: true })
        return
      }
      throw readErr
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
      return
    }

    // Auto-fallback: if PC Server failed, auto-switch to Laptop and retry once
    if (settings.activeEngine === 'pc' && settings.autoFallback !== false && !isFallbackRetry) {
      console.warn('PC Server connection failed during chat. Falling back to Laptop...', err)
      settings.activeEngine = 'laptop'
      saveSettingsToStorage(settings)

      window.dispatchEvent(
        new CustomEvent('engine-fallback', {
          detail: {
            from: 'PC Server',
            to: 'Laptop',
            message: 'Koneksi PC Server terputus. Mengalihkan ke Laptop.',
          },
        })
      )

      return sendMessageStream({
        model,
        messages,
        onToken,
        onDone,
        onError,
        signal,
        isFallbackRetry: true,
      })
    }

    onError?.(err)
  }
}
