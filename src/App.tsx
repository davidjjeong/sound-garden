import { Navigate, Route, Routes } from 'react-router-dom'
import { Header } from './components/Header'
import { Landing } from './components/Landing'
import { Studio } from './components/studio/Studio'
import { useSession } from './hooks/useSession'
import './App.css'
import './surfaces.css'

function App() {
  const { user, loading, error } = useSession()

  return (
    <>
      <Header user={user} />
      {loading ? (
        <main className="session-status" role="status">Loading your account…</main>
      ) : error ? (
        <main className="session-status" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => window.location.reload()}>Try again</button>
        </main>
      ) : (
        <Routes>
          <Route path="/" element={user ? <Navigate to="/studio" replace /> : <Landing />} />
          <Route path="/studio" element={user ? <Studio /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </>
  )
}

export default App
