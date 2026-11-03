import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type HeaderProps = { user: User | null }

export function Header({ user }: HeaderProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function signOut() {
    setBusy(true)
    setError('')
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not sign out.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <header className="app-header">
      <Link to="/" className="logo">
        <svg viewBox="0 0 32 32" width="30" height="30" fill="none" aria-hidden="true">
          <path d="M16 27V16C16 7 24 5 29 5c0 8-5 14-13 14M16 22C7 22 3 16 3 10c8 0 13 4 13 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        sound garden
      </Link>
      {user && (
        <div className="account">
          <span className="account-email">{user.email ?? 'Your account'}</span>
          <button type="button" onClick={signOut} disabled={busy}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
          {error && <span role="alert">{error}</span>}
        </div>
      )}
    </header>
  )
}
