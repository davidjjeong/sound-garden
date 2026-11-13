export function validateAudioFile(file: File): string | null {
  if (!/\.(mp3|wav)$/i.test(file.name)) return 'Please choose an MP3 or WAV file.'
  if (file.size <= 0 || file.size > 20 * 1024 * 1024) return 'Choose a nonempty audio file up to 20 MiB.'
  if (file.name.length > 255) return 'Choose a filename of at most 255 characters.'
  return null
}
