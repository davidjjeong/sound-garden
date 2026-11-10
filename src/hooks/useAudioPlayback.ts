import { useEffect, useRef, useState } from 'react'
import { getTrackPlaybackUrl } from '../lib/tracks'
import { createAudioEngine, type AudioEngine } from '../lib/audioEngine'
import type { LibraryTrack, TrackPlaybackUrl } from '../types/tracks'

const initial = {
  track: null as LibraryTrack | null,
  isLoading: false, isPlaying: false, isUnavailable: false,
  position: 0, duration: 0, volume: 1, error: '', notice: '',
}

export function useAudioPlayback() {
  const [state, setState] = useState(initial)
  const audio = useRef<HTMLAudioElement | null>(null)
  const selected = useRef<LibraryTrack | null>(null)
  const source = useRef<TrackPlaybackUrl | null>(null)
  const generation = useRef(0)
  const wantsPlay = useRef(false)
  const loading = useRef(false)
  const restorePosition = useRef<number | null>(null)
  const blockedIds = useRef(new Set<string>())
  const mounted = useRef(false)
  const lastAudibleVolume = useRef(1)
  const engine = useRef<AudioEngine | null>(null)
  const volumeRef = useRef(1)

  useEffect(() => {
    mounted.current = true
    const element = new Audio()
    element.preload = 'metadata'
    element.crossOrigin = 'anonymous'
    audio.current = element
    const invalidate = () => { generation.current++ }
    const current = () => mounted.current && source.current !== null &&
      (element.currentSrc || element.src) === source.current.url
    const metadata = () => {
      if (!current()) return
      const duration = Number.isFinite(element.duration) ? Math.max(0, element.duration) : 0
      if (restorePosition.current !== null && duration > 0) {
        element.currentTime = Math.min(restorePosition.current, duration)
        restorePosition.current = null
      }
      setState((previous) => ({ ...previous, duration, position: element.currentTime }))
    }
    const playing = () => {
      if (!current()) return
      if (!wantsPlay.current) { element.pause(); return }
      setState((previous) => ({ ...previous, isPlaying: true, isLoading: false, error: '', notice: '' }))
    }
    const paused = () => {
      if (current() && element.paused) setState((previous) => ({ ...previous, isPlaying: false, isLoading: false }))
    }
    const time = () => {
      if (current()) setState((previous) => ({ ...previous, position: element.currentTime }))
    }
    const ended = () => {
      if (!current() || !element.ended) return
      wantsPlay.current = false
      setState((previous) => ({ ...previous, isPlaying: false, isLoading: false, position: element.currentTime }))
    }
    const waiting = () => {
      if (current() && wantsPlay.current) setState((previous) => ({ ...previous, isLoading: true }))
    }
    const canPlay = () => {
      if (current()) setState((previous) => ({ ...previous, isLoading: false }))
    }
    const failed = () => {
      if (!current() || !element.error) return
      wantsPlay.current = false
      setState((previous) => ({ ...previous, isPlaying: false, isLoading: false,
        error: element.error?.code === 4 ? 'Your browser cannot play this audio format.' : 'The audio could not be loaded. Retry playback.' }))
    }
    const handlers = { loadedmetadata: metadata, durationchange: metadata, playing, pause: paused,
      timeupdate: time, ended, waiting, canplay: canPlay, error: failed }
    for (const [event, handler] of Object.entries(handlers)) element.addEventListener(event, handler)
    return () => {
      mounted.current = false
      invalidate()
      wantsPlay.current = false
      source.current = null
      for (const [event, handler] of Object.entries(handlers)) element.removeEventListener(event, handler)
      element.pause()
      element.removeAttribute('src')
      element.load()
      audio.current = null

      const currentEngine = engine.current
      engine.current = null

      if(currentEngine) {
        void currentEngine.dispose().catch(() => {}) // browser may already be closing context
      }
    }
  }, [])

  function releaseSource() {
    source.current = null
    loading.current = false
    restorePosition.current = null
    audio.current?.pause()
    audio.current?.removeAttribute('src')
    audio.current?.load()
  }

  async function startElement(version: number) {
    const element = audio.current
    if (!element) return
    try {
      if(!engine.current) { // create audio engine, keeps tied to playback interaction
        engine.current = createAudioEngine(element)
        engine.current.setVolume(volumeRef.current)
      }
      await engine.current.resume()

      if( // prevents playback if user switched tracks or began deletion while resume() was pending
        !mounted.current ||
        version !== generation.current ||
        !wantsPlay.current
      ) return

      await element.play()
      // Playback promises may settle after a pause/deletion/track switch.
      if (version === generation.current && !wantsPlay.current) element.pause()
    } catch (failure) {
      if (!mounted.current || version !== generation.current || !wantsPlay.current) return
      wantsPlay.current = false
      const blocked = failure instanceof DOMException && failure.name === 'NotAllowedError'
      setState((previous) => ({ ...previous, isLoading: false, isPlaying: false,
        notice: blocked ? 'Press Play to start audio.' : '',
        error: blocked ? '' : 'Playback could not start. Retry playback.' }))
    }
  }

  async function prepare(track: LibraryTrack, position: number) {
    const version = ++generation.current
    releaseSource()
    loading.current = true
    setState((previous) => ({ ...previous, isLoading: true, isPlaying: false, error: '', notice: '' }))
    try {
      const signed = await getTrackPlaybackUrl(track)
      if (!mounted.current || version !== generation.current || blockedIds.current.has(track.id)) return
      const element = audio.current!
      source.current = signed
      restorePosition.current = position
      element.src = signed.url
      element.load()
      loading.current = false
      if (wantsPlay.current) await startElement(version)
      else setState((previous) => ({ ...previous, isLoading: false }))
    } catch {
      if (!mounted.current || version !== generation.current) return
      loading.current = false
      wantsPlay.current = false
      setState((previous) => ({ ...previous, isLoading: false, isPlaying: false,
        error: 'Could not load this track. Check your connection and retry playback.' }))
    }
  }

  function select(track: LibraryTrack) {
    if (blockedIds.current.has(track.id)) return
    if (selected.current?.id === track.id) {
      if (wantsPlay.current) pause()
      else if (state.error) retry()
      else play()
      return
    }
    selected.current = track
    wantsPlay.current = true
    setState((previous) => ({ ...initial, volume: previous.volume, track }))
    void prepare(track, 0)
  }
  function pause() {
    wantsPlay.current = false
    audio.current?.pause()
    setState((previous) => ({ ...previous, isPlaying: false }))
  }
  function play() {
    const track = selected.current
    const element = audio.current
    if (!track || !element || blockedIds.current.has(track.id)) return
    wantsPlay.current = true
    if (loading.current) return
    if (!source.current || source.current.expiresAt <= Date.now() + 30000) {
      void prepare(track, element.ended ? 0 : element.currentTime || 0)
    } else {
      if (element.ended) element.currentTime = 0
      setState((previous) => ({ ...previous, error: '', notice: '' }))
      void startElement(generation.current)
    }
  }
  function seek(position: number) {
    const element = audio.current
    if (!element || !source.current || !Number.isFinite(element.duration) || !Number.isFinite(position)) return
    element.currentTime = Math.max(0, Math.min(position, element.duration))
    setState((previous) => ({ ...previous, position: element.currentTime }))
  }
  function setVolume(value: number) {
    if (!Number.isFinite(value)) return
    const volume = Math.max(0, Math.min(value, 1))
    volumeRef.current = volume
    if (volume > 0) lastAudibleVolume.current = volume
    engine.current?.setVolume(volume)
    setState((previous) => ({ ...previous, volume }))
  }
  function toggleMute() {
    setVolume(volumeRef.current > 0 ? 0 : lastAudibleVolume.current)
  }
  function retry() {
    const track = selected.current
    if (!track || loading.current || blockedIds.current.has(track.id)) return
    wantsPlay.current = true
    void prepare(track, audio.current?.currentTime || state.position)
  }
  function beginDeletion(id: string) {
    // Keep this ID blocked after uncertain deletion; another selection is allowed.
    blockedIds.current.add(id)
    if (selected.current?.id !== id) return
    generation.current++
    wantsPlay.current = false
    releaseSource()
    setState((previous) => ({ ...previous, isPlaying: false, isLoading: false,
      isUnavailable: true, error: '', notice: 'Playback stopped for deletion.' }))
  }
  function completeDeletion(id: string) {
    if (selected.current?.id !== id) return
    generation.current++
    wantsPlay.current = false
    selected.current = null
    releaseSource()
    setState((previous) => ({ ...initial, volume: previous.volume }))
  }
  function readWaveForm(): Float32Array | null {
    return engine.current?.readWaveForm() ?? null
  }
  return { ...state, select, play, pause, seek, setVolume, toggleMute, retry, beginDeletion, completeDeletion, readWaveForm }
}

export type AudioPlayback = ReturnType<typeof useAudioPlayback>
