import { expect, it } from 'vitest'
import { demoTracks, resolveDemoPlaybackUrl, sampleTrack } from '../../src/lib/demoTracks'

it('supplies one static sample and resolves its absolute URL without expiry', async () => {
  expect(demoTracks).toEqual([sampleTrack])
  expect(await resolveDemoPlaybackUrl(sampleTrack)).toEqual({
    url: new URL('/audio/cipher.mp3', window.location.href).href, expiresAt: Infinity,
  })
})
