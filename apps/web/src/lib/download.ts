/** Saves text or bytes as a file via a short-lived object URL. */
export function downloadBlob(data: string | Uint8Array, mime: string, fileName: string): void {
  const part: BlobPart = typeof data === 'string' ? data : (data as Uint8Array<ArrayBuffer>)
  const blob = new Blob([part], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
