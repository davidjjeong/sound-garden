import type { ReactNode } from 'react'
import type { AudioPlayback } from '../../hooks/useAudioPlayback'
import { AudioPlayer } from './AudioPlayer'
import { WaveformView } from './WaveformView'
import { GestureControls } from './GestureControls'
import './Studio.css'

export function StudioWorkspace({ playback, library }: { playback: AudioPlayback; library: ReactNode }) {
  return (
    <main className="studio-layout">
      <section className="track-panel" aria-labelledby="library-title">
        {library}
        <AudioPlayer playback={playback} />
      </section>
      <section className="waveform-panel" aria-labelledby="waveform-title">
        <GestureControls volume={playback.volume} manualVolumeRevision={playback.manualVolumeRevision}
          onVolumeChange={playback.setGestureVolume}
          canTogglePlayback={Boolean(playback.track) && !playback.isLoading && !playback.isUnavailable}
          isPlaying={playback.isPlaying}
          onTogglePlayback={() => { if (playback.isPlaying) playback.pause(); else playback.play() }} />
        <WaveformView
          readFrequencyBands={playback.readFrequencyBands}
          isPlaying={playback.isPlaying}
        />
      </section>
    </main>
  )
}
