export type ReservedTrack = {
    id: string
    title: string
    status: 'pending' | 'ready'
    storagePath: string
    mimeType: string
    sizeBytes: number
    expiresAt: string | null
}

export type SignedUpload = {
    bucket: string
    path: string
    token: string
}

export type ReservationResponse = 
    | {
        action: 'upload'
        track: ReservedTrack
        upload: SignedUpload
    } 
    | {
        action: 'finalize'
        track: ReservedTrack
    }
    | {
        action: 'ready'
        track: ReservedTrack
    }

export type ReadyTrack = ReservedTrack & { status: 'ready' }

export type FinalizationResponse = {
  action: 'ready'
  track: ReadyTrack
}
