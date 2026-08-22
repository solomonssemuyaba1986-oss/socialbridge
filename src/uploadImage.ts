/** Compress an image (max ~1024px JPEG) and upload to Cloudinary, returning the secure URL. */
export async function uploadImageToCloudinary(file: File): Promise<string> {
  const processedBlob = await resizeImage(file, 1024, 0.8)
  const processedFile = new File([processedBlob], 'photo.jpg', { type: 'image/jpeg' })
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

function resizeImage(file: File, maxWidth = 1024, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
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
          if (blob) resolve(blob)
          else reject(new Error('Image resize failed'))
        }, 'image/jpeg', quality)
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = URL.createObjectURL(file)
  })
}
