import type { PlaybackTrack, TrackPlaybackUrl } from '../types/tracks'

export type DemoTrack = PlaybackTrack & { url: string }
export const sampleTrack: DemoTrack = {
  id: 'demo-cipher', title: 'Cipher — Kevin MacLeod', size_bytes: 9252699,
  url: `${import.meta.env.BASE_URL}audio/cipher.mp3`,
}
export const demoTracks = [sampleTrack]

export async function resolveDemoPlaybackUrl(track: DemoTrack): Promise<TrackPlaybackUrl> {
  return { url: new URL(track.url, window.location.href).href, expiresAt: Infinity }
}
