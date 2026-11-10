export function createAudioEngine(
    element: HTMLAudioElement,
) {
    const context = new AudioContext() // audio-processing env
    const source = context.createMediaElementSource(element) // takes decoded audio from our exisiting player
    const gain = context.createGain() // volume control
    const analyser = context.createAnalyser() // reads signal after volume adjustment

    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.35

    source.connect(gain)
    gain.connect(analyser)
    analyser.connect(context.destination) // sends processed audio to the speakers

    const samples = new Float32Array(analyser.fftSize)
    const spectrum = new Float32Array(analyser.frequencyBinCount)
    const bands = new Float32Array(96)
    const bandEdges = Array.from({ length: bands.length + 1 }, (_, i) =>
        Math.min(spectrum.length, Math.max(1, Math.round(40 * (Math.min(16000, context.sampleRate / 2) / 40) ** (i / bands.length) * analyser.fftSize / context.sampleRate))))

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
        readFrequencyBands() {
            analyser.getFloatFrequencyData(spectrum)
            for (let band = 0; band < bands.length; band++) {
                const start = Math.min(bandEdges[band], spectrum.length - 1)
                const end = Math.min(spectrum.length, Math.max(start + 1, bandEdges[band + 1]))
                let power = 0
                for (let bin = start; bin < end; bin++) power += 10 ** (spectrum[bin] / 10)
                bands[band] = Math.sqrt(power / (end - start))
            }
            return bands
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