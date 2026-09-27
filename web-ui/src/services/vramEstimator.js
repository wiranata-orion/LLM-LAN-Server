/**
 * VRAM Guard (#15) - an honest ESTIMATE, not exact accounting. Getting exact
 * VRAM usage right requires per-architecture GGUF metadata (layer count,
 * hidden size, KV head count - these vary by model family and Ollama's own
 * field names for them differ per architecture prefix), which isn't reliably
 * available from the plain model list this app already has. Instead this
 * uses two numbers that ARE reliably available and combines them with a
 * widely-cited rule of thumb for the part that isn't:
 *
 *   1. Model weights ≈ the .gguf file size Ollama already reports
 *      (model.size, in bytes) - quantization is already baked into that
 *      number, so a Q4 7B model correctly comes out smaller than a Q8 one.
 *   2. KV cache ≈ context_length * params_in_billions * a constant.
 *      Calibrated against Llama-2-7B's known architecture (32 layers, 4096
 *      hidden dim, fp16 KV): bytes/token = 2(K+V) * 32 * 4096 * 2 = 524,288,
 *      divided by 7B params = ~74,900 bytes/token/billion-params. Real models
 *      split the same param count between depth and width differently (a
 *      deep-narrow model needs less KV per token than a shallow-wide one
 *      with the same total params), so this is a representative constant,
 *      not a universal law - exactly why the UI states this is an estimate.
 */

// Bytes of KV cache per context token per billion parameters (fp16 KV cache).
const KV_BYTES_PER_TOKEN_PER_BILLION_PARAMS = 75_000
// Rough fixed cost of the CUDA/ROCm context, activations, and Ollama's own
// runtime overhead - small next to weights+KV for any real model, but never
// literally zero, so a "just barely fits" estimate doesn't ignore it.
const FIXED_OVERHEAD_BYTES = 400 * 1024 * 1024

/**
 * Parses Ollama's `details.parameter_size` (e.g. "7.6B", "1.2B", "70B") or,
 * failing that, a model tag's trailing size segment (e.g. "qwen2.5:7b",
 * "llama3.2:1b") into a plain number of billions.
 * @returns {number | null} null if no parameter count could be determined at all.
 */
export function parseParameterCountBillions(model) {
  const fromDetails = model?.details?.parameter_size
  if (typeof fromDetails === 'string') {
    const match = fromDetails.match(/([\d.]+)\s*B/i)
    if (match) return parseFloat(match[1])
  }
  const name = typeof model === 'string' ? model : model?.name
  if (typeof name === 'string') {
    // Matches "...:7b", "...-7b", "...7B-instruct" - the LAST such token in
    // the name, since some names also embed unrelated numbers earlier
    // (e.g. "llama3.2:1b" - the "3.2" is a version, not a size).
    const matches = [...name.matchAll(/(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/gi)]
    if (matches.length) return parseFloat(matches[matches.length - 1][1])
  }
  return null
}

/**
 * @param {{ modelSizeBytes: number, paramsB: number | null, numCtx: number }} input
 * @returns {{ weightsBytes: number, kvCacheBytes: number, overheadBytes: number, totalBytes: number, paramsKnown: boolean }}
 */
export function estimateVramUsage({ modelSizeBytes, paramsB, numCtx }) {
  const weightsBytes = modelSizeBytes || 0
  // Without a parameter count, fall back to a conservative flat guess (2.5%
  // of the weight size per 1K ctx) rather than reporting zero KV cache,
  // which would make a huge context window on an unknown model look free.
  const effectiveParamsB = paramsB ?? Math.max(1, weightsBytes / 1.5e9)
  const kvCacheBytes = Math.max(0, numCtx || 0) * effectiveParamsB * KV_BYTES_PER_TOKEN_PER_BILLION_PARAMS
  const overheadBytes = FIXED_OVERHEAD_BYTES
  return {
    weightsBytes,
    kvCacheBytes,
    overheadBytes,
    totalBytes: weightsBytes + kvCacheBytes + overheadBytes,
    paramsKnown: paramsB !== null && paramsB !== undefined,
  }
}

const GB = 1024 ** 3

/**
 * @param {{ model: object | string, numCtx: number, vramLimitGb: number }} input
 * @returns {{
 *   level: 'safe' | 'optimal' | 'good' | 'warning' | 'critical',
 *   totalGb: number, limitGb: number, percentUsed: number, paramsKnown: boolean,
 *   title: string, estimate: string, description: string,
 * }}
 */
export function getVramGuardStatus({ model, numCtx, vramLimitGb }) {
  const modelSizeBytes = typeof model === 'object' ? (model?.size || 0) : 0
  const paramsB = model ? parseParameterCountBillions(model) : null
  const { totalBytes, paramsKnown } = estimateVramUsage({ modelSizeBytes, paramsB, numCtx })

  const totalGb = totalBytes / GB
  const limitGb = vramLimitGb || 8
  const percentUsed = limitGb > 0 ? (totalGb / limitGb) * 100 : 0

  if (!modelSizeBytes) {
    return {
      level: 'unknown', totalGb: 0, limitGb, percentUsed: 0, paramsKnown: false,
      title: 'Belum ada model terpilih',
      estimate: '-',
      description: 'Pilih model untuk melihat estimasi kebutuhan VRAM.',
    }
  }

  let level
  let title
  if (percentUsed < 50) {
    level = 'safe'
    title = 'Aman - sisa VRAM lega'
  } else if (percentUsed < 80) {
    level = 'optimal'
    title = 'Optimal - dalam batas wajar'
  } else if (percentUsed < 100) {
    level = 'good'
    title = 'Mendekati batas VRAM'
  } else if (percentUsed < 130) {
    level = 'warning'
    title = 'Kemungkinan melebihi VRAM'
  } else {
    level = 'critical'
    title = 'Sangat mungkin melebihi VRAM'
  }

  const description = percentUsed >= 100
    ? `Estimasi ~${totalGb.toFixed(1)} GB melebihi limit ${limitGb} GB - model mungkin sebagian dijalankan di RAM (jauh lebih lambat) atau gagal dimuat. Coba turunkan context window atau pilih model/kuantisasi yang lebih kecil.`
    : `Estimasi ~${totalGb.toFixed(1)} GB dari limit ${limitGb} GB (${percentUsed.toFixed(0)}%).`

  return {
    level,
    totalGb,
    limitGb,
    percentUsed,
    paramsKnown,
    title,
    estimate: `~${totalGb.toFixed(1)} GB / ${limitGb} GB`,
    description: paramsKnown ? description : `${description} (jumlah parameter model tidak terdeteksi - estimasi kasar dari ukuran file saja).`,
  }
}
