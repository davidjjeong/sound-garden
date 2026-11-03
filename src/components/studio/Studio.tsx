import { TrackLibrary } from './TrackLibrary'
import { AudioPlayer } from './AudioPlayer'
import { WaveformView } from './WaveformView'
import { GestureControls } from './GestureControls'
import './Studio.css'

export function Studio() {
  return (
    <main className="studio-layout">
      <section className="track-panel" aria-labelledby="library-title">
        <TrackLibrary />
        <AudioPlayer />
      </section>
      <section className="waveform-panel" aria-labelledby="waveform-title">
        <WaveformView />
        <GestureControls />
      </section>
    </main>
  )
}
