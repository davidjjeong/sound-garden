import { Link } from 'react-router-dom'
import { useState } from 'react'
import { AuthForm } from './AuthForm'
import { WaveArtwork } from './WaveArtwork'

export function Landing() {
  const [authMode, setAuthMode] = useState<
    'signup' | 'signin' | null
  >(null)

  if (authMode) {
    return (
      <main className="landing">
        <AuthForm
          key={authMode}
          mode={authMode}
          onClose={() => setAuthMode(null)}
          onSwitch={() => setAuthMode(authMode === 'signup' ? 'signin' : 'signup')}
        />
      </main>
    )
  }

  return (
    <main className="landing">
      <section className="hero">
        <div className="hero-copy">
          <h1>Your music, in motion.</h1>
          <p>
            A personal music playground you can shape with your hands.
          </p>

          <div className="hero-actions">
            <Link className="demo-link" to="/demo">Try demo</Link>
            <button
              type="button"
              onClick={() => setAuthMode('signup')}
            >
              Create your garden
            </button>

            <button
              type="button"
              onClick={() => setAuthMode('signin')}
            >
              Sign in
            </button>
          </div>
        </div>

        <div className="hero-visual">
          <WaveArtwork />
        </div>
      </section>
    </main>
  )
}
