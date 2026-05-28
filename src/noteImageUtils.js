export const readClipboardImages = async (clipboardData) => {
  if (!clipboardData?.items?.length) return []

  const imageItems = Array.from(clipboardData.items)
    .filter((item) => item.type?.startsWith('image/'))

  if (imageItems.length === 0) return []

  const images = await Promise.all(imageItems.map((item) => new Promise((resolve) => {
    const file = item.getAsFile?.()
    if (!file) {
      resolve(null)
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      resolve({
        id: crypto.randomUUID(),
        src: typeof reader.result === 'string' ? reader.result : '',
        mimeType: file.type || item.type || 'image/png',
      })
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })))

  return images.filter((image) => image?.src)
}
