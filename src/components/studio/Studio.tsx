import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAudioPlayback } from '../../hooks/useAudioPlayback'
import { TrackLibrary } from './TrackLibrary'
import { StudioWorkspace } from './StudioWorkspace'

const BenchmarkPanel = import.meta.env.DEV ? lazy(() => import('./BenchmarkPanel')) : null

export function Studio() {
  const [searchParams] = useSearchParams()
  const playback = useAudioPlayback()
  return <>
    {BenchmarkPanel && searchParams.get('benchmark') === '1' && <Suspense fallback={null}><BenchmarkPanel /></Suspense>}
    <StudioWorkspace playback={playback} library={
    <TrackLibrary selectedTrackId={playback.track?.id ?? null} isPlaying={playback.isPlaying}
      isLoadingTrack={playback.isLoading} onSelectTrack={playback.select}
      onDeleteStart={playback.beginDeletion} onTrackDeleted={playback.completeDeletion} />
  } />
  </>
}
