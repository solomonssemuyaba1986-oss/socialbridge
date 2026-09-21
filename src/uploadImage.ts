/** Compress an image (max ~1024px JPEG) and upload to Cloudinary, returning the secure URL. */
export async function uploadImageToCloudinary(file: File): Promise<string> {
  const processedBlob = await resizeImage(file, 1024, 0.8)
  return postToCloudinary(processedBlob, 'photo.jpg')
}

/**
 * A shop's logo is drawn as a circle, so a portrait phone photo has to be cropped square
 * before it is stored — otherwise every shop's face arrives squashed. Centre-crop, 512px,
 * same uploader and preset as everything else.
 */
export async function uploadSquareImageToCloudinary(file: File, size = 512): Promise<string> {
  const processedBlob = await resizeToSquare(file, size)
  return postToCloudinary(processedBlob, 'logo.jpg')
}

/** The one place that talks to Cloudinary (unsigned preset, public URLs). */
async function postToCloudinary(blob: Blob, filename: string): Promise<string> {
  const processedFile = new File([blob], filename, { type: 'image/jpeg' })
  const formData = new FormData()
  formData.append('file', processedFile)
  formData.append('upload_preset', import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'p2z65zrv')
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'dzudmmuxg'}/image/upload`,
    { method: 'POST', body: formData }
  )
  if (!res.ok) throw new Error('Upload failed')
  const data = await res.json()
  return data.secure_url
}

function loadImage(file: File): Promise<{ img: HTMLImageElement; release: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ img, release: () => URL.revokeObjectURL(url) })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Image load failed'))
    }
    img.src = url
  })
}

function resizeImage(file: File, maxWidth = 1024, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    loadImage(file).then(({ img, release }) => {
      try {
        const scale = Math.min(1, maxWidth / img.width)
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, w, h)
        canvas.toBlob((blob) => {
          release()
          if (blob) resolve(blob)
          else reject(new Error('Image resize failed'))
        }, 'image/jpeg', quality)
      } catch (err) {
        release()
        reject(err)
      }
    }, reject)
  })
}

/** Centre-crop to a square, so a logo is never stretched. */
function resizeToSquare(file: File, size: number, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    loadImage(file).then(({ img, release }) => {
      try {
        const side = Math.min(img.width, img.height)
        const sx = Math.round((img.width - side) / 2)
        const sy = Math.round((img.height - side) / 2)
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
        canvas.toBlob((blob) => {
          release()
          if (blob) resolve(blob)
          else reject(new Error('Image resize failed'))
        }, 'image/jpeg', quality)
      } catch (err) {
        release()
        reject(err)
      }
    }, reject)
  })
}
