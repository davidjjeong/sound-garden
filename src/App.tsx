import './App.css'

function App() {
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
            <button type="button">Create your garden</button>
            <button type="button">Sign in</button>
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
