import { expect, it } from 'vitest'
import { hashAudioFile } from '../../src/lib/contentHash'

it('hashes bytes rather than filename and recognizes the SHA-256 test vector', async () => {
  const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  expect(await hashAudioFile(new File(['abc'], 'first.mp3'))).toBe(expected)
  expect(await hashAudioFile(new File(['abc'], 'renamed.wav'))).toBe(expected)
  expect(await hashAudioFile(new File(['abd'], 'first.mp3'))).not.toBe(expected)
})
it('reuses the fingerprint calculation for retries of the same File object', () => {
  const file = new File(['abc'], 'song.mp3')
  expect(hashAudioFile(file)).toBe(hashAudioFile(file))
})
