import { useState } from 'react'
import { AuthForm } from './components/AuthForm'
import './App.css'

function App() {
  const [authMode, setAuthMode] = useState<'signup' | 'signin' | null>(null)

  if (authMode) {
    return (
      <main className="landing">
        <AuthForm key={authMode} mode={authMode} onClose={() => setAuthMode(null)} />
      </main>
    )
  }

  return (
    <main className="landing">
      <header className="landing-header">
        <a href="/" className="logo">
          sound garden
        </a>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1>Your music, in motion.</h1>
          <p>A personal music playground you can shape with your hands.</p>

          <div className="hero-actions">
            <button type="button" onClick={() => setAuthMode('signup')}>
              Create your garden
            </button>
            <button type="button" onClick={() => setAuthMode('signin')}>
              Sign in
            </button>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          Waveform preview
        </div>
      </section>
    </main>
  )
}

export default App
