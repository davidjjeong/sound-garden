export class DuplicateTrackError extends Error {
  readonly code = 'DUPLICATE_TRACK'
  constructor() {
    super('This file is already in your library.')
    this.name = 'DuplicateTrackError'
  }
}
