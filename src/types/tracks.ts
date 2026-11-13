export type PlaybackTrack = { id: string; title: string; size_bytes: number }

export type LibraryTrack = PlaybackTrack & {
  storage_path: string
  created_at: string
}

export type TrackPlaybackUrl = { url: string; expiresAt: number }
