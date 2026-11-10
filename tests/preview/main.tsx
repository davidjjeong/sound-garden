import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '../../src/index.css'
import { Studio } from '../../src/components/studio/Studio'
import '../../src/App.css'
import '../../src/surfaces.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <p style={{ padding: '12px 24px', margin: 0, fontSize: 12, color: '#597161' }}>
      Isolated playback preview · generated silent WAV files · no Supabase connection
    </p>
    <Studio />
  </StrictMode>,
)
