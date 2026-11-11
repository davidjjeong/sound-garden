import { useAudioPlayback } from '../../hooks/useAudioPlayback'
import { TrackLibrary } from './TrackLibrary'
import { AudioPlayer } from './AudioPlayer'
import { WaveformView } from './WaveformView'
import { GestureControls } from './GestureControls'
import './Studio.css'

export function Studio() {
  const playback = useAudioPlayback()
  return (
    <main className="studio-layout">
      <section className="track-panel" aria-labelledby="library-title">
        <TrackLibrary selectedTrackId={playback.track?.id ?? null} isPlaying={playback.isPlaying}
          isLoadingTrack={playback.isLoading} onSelectTrack={playback.select}
          onDeleteStart={playback.beginDeletion} onTrackDeleted={playback.completeDeletion} />
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
