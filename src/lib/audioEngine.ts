export function createAudioEngine(
    element: HTMLAudioElement,
) {
    const context = new AudioContext() // audio-processing env
    const source = context.createMediaElementSource(element) // takes decoded audio from our exisiting player
    const gain = context.createGain() // volume control
    const analyser = context.createAnalyser() // reads signal after volume adjustment

    analyser.fftSize = 2048

    source.connect(gain)
    gain.connect(analyser)
    analyser.connect(context.destination) // sends processed audio to the speakers

    const samples = new Float32Array(analyser.fftSize)

    return {
        async resume() { // unlocks suspended context during user playback interaction
            if (context.state === 'suspended') await context.resume()
        },
        setVolume(volume: number) { // clamps volume and changes gradually to avoid abrupt jumps
            if(!Number.isFinite(volume)) return

            const value = Math.max(0, Math.min(volume, 1))
            const now = context.currentTime

            gain.gain.cancelScheduledValues(now)
            gain.gain.setTargetAtTime(value, now, 0.02)
        },
        readWaveForm() { // fills and returns same sample array each time (no new array every frame)
            analyser.getFloatTimeDomainData(samples)
            return samples
        },
        async dispose() { // disconnects nodes and closes context
            source.disconnect()
            gain.disconnect()
            analyser.disconnect()

            await context.close()
        },
    }
}

export type AudioEngine = ReturnType<typeof createAudioEngine>