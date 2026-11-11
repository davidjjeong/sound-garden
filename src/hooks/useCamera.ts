import { useEffect, useRef, useState } from 'react'

export function useCamera() {
    const videoRef = useRef<HTMLVideoElement | null>(null) // points to <video> element that displays the preview
    const streamRef = useRef<MediaStream | null>(null) // stores camera stream
    const startingRef = useRef(false) // prevents multiple camera reqs while one is pending
    const generationRef = useRef(0) // identifies current req, invalidates older reqs

    const [enabled, setEnabled] = useState(false) // whether preview successfully started
    const [error, setError] = useState('') // msg when starting fails

    function stop() { // releases the camera
        generationRef.current++ // invalidates any pending req

        streamRef.current?.getTracks().forEach(track => track.stop()) // releases camera
        streamRef.current = null

        // disconnects preview, updates UI
        if(videoRef.current) videoRef.current.srcObject = null
        setEnabled(false)
    }

    async function start() { // prevents duplicate reqs
        if(startingRef.current || streamRef.current) return

        startingRef.current = true // marks req as pending
        const generation = ++generationRef.current // save its identifier
        setError('') // clear prev error

        try {
            // requests a camera stream
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'user',
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                },
                audio: false,
            })

            // ignore a request that finishes after Stop or unmount
            if (generation !== generationRef.current) {
                stream.getTracks().forEach(track => track.stop())
                return
            }

            streamRef.current = stream

            const video = videoRef.current
            if (!video) {
                stop()
                return
            }

            video.srcObject = stream // accepts a live media stream
            await video.play() // starts displaying

            if (generation === generationRef.current) {
                setEnabled(true)
            }
        } catch {
            if (generation === generationRef.current) {
                stop()
                setError('Could not start the camera. Check camera permission.')
            }
        } finally {
            startingRef.current = false
        }
    }

    useEffect(() => { // cleanup when component unmounts
        return () => {
            generationRef.current++
            streamRef.current?.getTracks().forEach(track => track.stop())
            streamRef.current = null
        }
    }, [])

    return { videoRef, enabled, error, start, stop }
}