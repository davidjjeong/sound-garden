// Test-only adapter: vite.config.ts substitutes this only for the isolated preview.
const owner = '22222222-2222-4222-8222-222222222222'
let tracks = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'Soft Orbit — silent test', storage_path: `${owner}/11111111-1111-4111-8111-111111111111.wav`, size_bytes: 320044, created_at: '2026-11-10' },
  { id: '33333333-3333-4333-8333-333333333333', title: 'Quiet Motion — silent test', storage_path: `${owner}/33333333-3333-4333-8333-333333333333.wav`, size_bytes: 320044, created_at: '2026-11-10' },
]
tracks.push(...Array.from({ length: 12 }, (_, index) => {
  const id = `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`
  return { id, title: `Studio sample ${index + 1} — silent test`, storage_path: `${owner}/${id}.wav`, size_bytes: 320044, created_at: '2026-11-10' }
}))
export const supabase = {
  from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [...tracks], error: null }) }) }) }),
  storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: `${window.location.origin}/__preview-audio.wav` }, error: null }) }) },
  functions: { invoke: async (name: string, options: { body: { trackId: string } }) => {
    if (name !== 'delete-track') return { data: null, error: new Error('Uploads are disabled in this test preview.') }
    tracks = tracks.filter((track) => track.id !== options.body.trackId)
    return { data: { action: 'deleted', trackId: options.body.trackId }, error: null }
  } },
}
