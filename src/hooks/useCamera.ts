import { useEffect, useRef, useState } from 'react'

type CameraResources = {
  generation: number
  starting: number | null
  stream: MediaStream | null
  video: HTMLVideoElement | null
  detachListeners: () => void
}
function releaseCamera(camera: CameraResources) {
  camera.generation++
  camera.starting = null
  camera.detachListeners()
  camera.detachListeners = () => {}
  camera.stream?.getTracks().forEach(track => track.stop())
  camera.stream = null
  if (camera.video) camera.video.srcObject = null
  camera.video = null
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const resources = useRef<CameraResources>({ generation: 0, starting: null, stream: null, video: null, detachListeners: () => {} })
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState('')
  function stop() {
    releaseCamera(resources.current)
    setEnabled(false)
  }
  async function start() {
    const camera = resources.current
    if (camera.starting !== null || camera.stream) return
    const generation = ++camera.generation
    camera.starting = generation
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
      })
      if (generation !== camera.generation) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      camera.stream = stream
      const disconnected = () => {
        if (generation !== camera.generation) return
        stop()
        setError('Camera disconnected. Reconnect it and enable the camera again.')
      }
      const tracks = stream.getTracks()
      tracks.forEach(track => track.addEventListener('ended', disconnected))
      camera.detachListeners = () => tracks.forEach(track => track.removeEventListener('ended', disconnected))
      const video = videoRef.current
      if (!video) { stop(); return }
      camera.video = video
      video.srcObject = stream
      await video.play()
      if (generation === camera.generation) setEnabled(true)
    } catch {
      if (generation === camera.generation) {
        stop()
        setError('Could not start the camera. Check camera permission.')
      }
    } finally {
      if (camera.starting === generation) camera.starting = null
    }
  }
  useEffect(() => {
    const camera = resources.current
    return () => releaseCamera(camera)
  }, [])
  return { videoRef, enabled, error, start, stop }
}
