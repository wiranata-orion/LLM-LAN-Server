import axios from 'axios'

export const DEFAULT_SETTINGS = {
  activeEngine: 'laptop', // 'pc' | 'laptop'
  pcUrl: 'http://192.168.1.50:11434',
  laptopUrl: 'http://localhost:11434',
  autoFallback: true,
  theme: 'xufruz', // 'xufruz' | 'cyberpunk' | 'oled' | 'light' | 'grey' | 'dark'
  // A 2048 window was too small to hold a real conversation once retrieved
  // context was added on top, so the model kept losing what was said earlier.
  numCtx: 4096, // fallback default
  numCtxLaptop: 4096, // Laptop (Local)
  numCtxPc: 8192,     // PC (Server)
  temperature: 0.7,
  maxTokens: '',
  // Model Auto: when enabled, the model used per message is picked automatically
  // based on the detected task category instead of the manually selected model.
  autoModelEnabled: false,
  autoModelMapLaptop: {},
  autoModelMapPc: {},
  // User-facing nicknames shown in the sidebar instead of the raw model id / GB size.
  // Keyed by the real Ollama model name; never changes the underlying model itself.
  modelNicknames: {},
  customTheme: {
    background: '#10131a',
    accent: '#22c55e',
    text: '#f3f4f6',
  },
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

/**
 * Rename (or clear) the sidebar label for a single model without touching
 * anyone else's nickname. This never changes the underlying Ollama model id.
 */
export function setModelNickname(modelName, nickname) {
  const current = getSettings()
  const nicknames = { ...(current.modelNicknames || {}) }
  const trimmed = (nickname || '').trim()
  if (trimmed) {
    nicknames[modelName] = trimmed
  } else {
    delete nicknames[modelName]
  }
  return saveSettingsToStorage({ modelNicknames: nicknames })
}

export function getModelDisplayName(modelName) {
  const settings = getSettings()
  return (settings.modelNicknames && settings.modelNicknames[modelName]) || modelName
}

/** Formats a duration in milliseconds as "3.2s" or "1m 05s", used for the live
 * generation timer and the final "answered in Xs" label shown after a reply. */
export function formatDuration(ms) {
  if (!ms || ms < 0) return '0.0s'
  const totalSeconds = ms / 1000
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function applyCustomTheme(customTheme = DEFAULT_SETTINGS.customTheme) {
  const root = document.documentElement
  const colors = {
    background: customTheme.background || DEFAULT_SETTINGS.customTheme.background,
    accent: customTheme.accent || DEFAULT_SETTINGS.customTheme.accent,
    text: customTheme.text || DEFAULT_SETTINGS.customTheme.text,
  }

  root.style.setProperty('--custom-bg', colors.background)
  root.style.setProperty('--custom-accent', colors.accent)
  root.style.setProperty('--custom-text', colors.text)
  const readableText = getReadableThemeText(colors.text, colors.background)
  const readableAccent = getContrastRatio(colors.accent, colors.background) >= 3
    ? colors.accent
    : readableText
  root.style.setProperty('--custom-readable-text', readableText)
  root.style.setProperty('--custom-readable-accent', readableAccent)
  root.style.setProperty('--color-on-bg', readableText)
  root.style.setProperty('--color-on-accent', getReadableTextColor(colors.accent))
}

export function clearCustomThemeContrast() {
  const root = document.documentElement
  root.style.removeProperty('--custom-readable-text')
  root.style.removeProperty('--custom-readable-accent')
  root.style.removeProperty('--color-on-bg')
  root.style.removeProperty('--color-on-accent')
}

function getReadableThemeText(textColor, backgroundColor) {
  return getContrastRatio(textColor, backgroundColor) >= 4.5
    ? textColor
    : getReadableTextColor(backgroundColor)
}

function getContrastRatio(firstColor, secondColor) {
  const firstLuminance = getRelativeLuminance(firstColor)
  const secondLuminance = getRelativeLuminance(secondColor)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function getRelativeLuminance(hexColor) {
  const hex = hexColor.replace('#', '')
  const normalized = hex.length === 3
    ? hex.split('').map((digit) => digit + digit).join('')
    : hex
  const channels = [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ))
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2])
}

function getReadableTextColor(hexColor) {
  const blackContrast = getContrastRatio('#10131a', hexColor)
  const whiteContrast = getContrastRatio('#ffffff', hexColor)
  return blackContrast >= whiteContrast ? '#10131a' : '#ffffff'
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
    ? (settings.numCtxPc || settings.numCtx || 8192)
    : (settings.numCtxLaptop || settings.numCtx || 4096)

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
