import { Link } from 'react-router-dom'
import { useAudioPlayback } from '../../hooks/useAudioPlayback'
import { demoTracks, resolveDemoPlaybackUrl } from '../../lib/demoTracks'
import { StudioWorkspace } from './StudioWorkspace'
import { TrackLibraryView } from './TrackLibraryView'

export function DemoStudio({ isSignedIn = false, sessionLoading = false }: { isSignedIn?: boolean; sessionLoading?: boolean }) {
  const playback = useAudioPlayback(resolveDemoPlaybackUrl)
  return <StudioWorkspace playback={playback} library={<>
    <div className="demo-notice">
      <span className="demo-label">Demo studio</span>
      <p>Play the sample, watch your music move, and enable the camera to try gesture controls.</p>
      {!sessionLoading && <Link to={isSignedIn ? '/studio' : '/'}>
        {isSignedIn ? 'Back to my studio' : 'Sign in to upload your own music'} <span aria-hidden="true">↗</span>
      </Link>}
    </div>
    <TrackLibraryView tracks={demoTracks} searchable={false} selectedTrackId={playback.track?.id ?? null}
      isPlaying={playback.isPlaying} isLoadingTrack={playback.isLoading}
      onSelectTrack={playback.select} />
    <p className="demo-credit">Sample: <a href="https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100844" target="_blank" rel="noreferrer">Cipher by Kevin MacLeod</a>
      {' · '}<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>.</p>
  </>} />
}
