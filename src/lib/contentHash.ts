/** Hash exact file bytes; renaming a file does not change this fingerprint. */
const hashes = new WeakMap<File, Promise<string>>()
export function hashAudioFile(file: File): Promise<string> {
  const existing = hashes.get(file)
  if (existing) return existing
  const result = (async () => {
    const bytes = await (typeof file.arrayBuffer === 'function' ? file.arrayBuffer() : new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(new Error('Could not read the audio file.'))
      reader.readAsArrayBuffer(file)
    }))
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  })()
  hashes.set(file, result)
  void result.catch(() => hashes.delete(file))
  return result
}
