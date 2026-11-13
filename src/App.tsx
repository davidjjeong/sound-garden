import { Navigate, Route, Routes, useMatch } from 'react-router-dom'
import { DemoStudio } from './components/studio/DemoStudio'
import { Header } from './components/Header'
import { Landing } from './components/Landing'
import { Studio } from './components/studio/Studio'
import { useSession } from './hooks/useSession'
import './App.css'
import './surfaces.css'

function App() {
  const { user, loading, error } = useSession()
  const isDemo = Boolean(useMatch('/demo'))
  const accountRoutes = loading ? (
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
  )
  return <>
    <Header user={isDemo ? null : user} />
    <Routes>
      <Route path="/demo" element={<DemoStudio isSignedIn={Boolean(user)} sessionLoading={loading} />} />
      <Route path="*" element={accountRoutes} />
    </Routes>
  </>
}

export default App
