import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const fakeClient = fileURLToPath(new URL('./supabase.ts', import.meta.url))
// Real browser media decoding without credentials or user files.
const samples = Buffer.alloc(20 * 8000 * 2)
const header = Buffer.alloc(44)
header.write('RIFF', 0); header.writeUInt32LE(36 + samples.length, 4); header.write('WAVEfmt ', 8)
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
header.writeUInt32LE(8000, 24); header.writeUInt32LE(16000, 28); header.writeUInt16LE(2, 32)
header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(samples.length, 40)
const wav = Buffer.concat([header, samples])

export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  plugins: [react(), {
    name: 'isolated-playback-fixtures',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer?.endsWith('/src/lib/tracks.ts') && source === './supabase') return fakeClient
    },
    configureServer(server) {
      server.middlewares.use('/__preview-audio.wav', (request, response) => {
        const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
        const start = range ? Number(range[1]) : 0
        const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1
        response.setHeader('Content-Type', 'audio/wav')
        response.setHeader('Accept-Ranges', 'bytes')
        if (start >= wav.length || end < start) { response.statusCode = 416; response.end(); return }
        if (range) { response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${wav.length}`) }
        response.setHeader('Content-Length', end - start + 1)
        response.end(wav.subarray(start, end + 1))
      })
    },
  }],
  server: { host: '127.0.0.1', port: 5181, strictPort: true, fs: { allow: [repository] } },
})
