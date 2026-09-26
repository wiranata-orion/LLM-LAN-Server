/**
 * Resizes an image file to a max 1024px on its longest side and returns it as
 * a base64 string (no data: URI prefix - that's the format Ollama's /api/chat
 * `images` field expects). Run client-side before ever sending a photo
 * onward: an un-resized phone photo can be 4000px+ and several MB, which on a
 * VRAM/compute-constrained local GPU turns into a much longer prompt-eval
 * than the image actually needs for a vision model to read it.
 */
const MAX_DIMENSION = 1024
const JPEG_QUALITY = 0.85

export function resizeImageToBase64(file, maxDimension = MAX_DIMENSION) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      let { width, height } = img
      if (width > maxDimension || height > maxDimension) {
        if (width >= height) {
          height = Math.round((height * maxDimension) / width)
          width = maxDimension
        } else {
          width = Math.round((width * maxDimension) / height)
          height = maxDimension
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas 2D context tidak tersedia'))
        return
      }
      ctx.drawImage(img, 0, 0, width, height)

      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
      const base64 = dataUrl.split(',')[1]
      if (!base64) {
        reject(new Error(`Gagal memproses gambar: ${file.name}`))
        return
      }
      resolve(base64)
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error(`Gagal memuat gambar: ${file.name}`))
    }

    img.src = objectUrl
  })
}

/** Converts several image files in order, so one bad file's error doesn't lose the others' base64 already computed. */
export async function resizeImagesToBase64(files, maxDimension = MAX_DIMENSION) {
  const results = []
  for (const file of files) {
    results.push(await resizeImageToBase64(file, maxDimension))
  }
  return results
}
