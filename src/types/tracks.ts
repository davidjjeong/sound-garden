export type LibraryTrack = {
  id: string
  title: string
  storage_path: string
  size_bytes: number
  created_at: string
}

export type TrackPlaybackUrl = { url: string; expiresAt: number }
