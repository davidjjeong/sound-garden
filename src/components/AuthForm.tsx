import { useState } from 'react'
import type { SubmitEvent } from 'react'
import { supabase } from '../lib/supabase'

type AuthFormProps = {
  mode: 'signup' | 'signin'
  onClose: () => void
  onSwitch: () => void
}

export function AuthForm({ mode, onClose, onSwitch }: AuthFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const isSignup = mode === 'signup'

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      const { data, error } = isSignup
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password })

      if (error) throw error

      if (data.session) {
        onClose()
      } else {
        setMessage('Check your email to confirm your account.')
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Something went wrong.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="auth-panel" aria-labelledby="auth-title">
      <span className="auth-eyebrow">sound garden</span>
      <h1 id="auth-title">
        {isSignup ? 'Create your account' : 'Welcome back'}
      </h1>
      <p className="auth-description">{isSignup ? 'A home for your music. A new way to play.' : 'Your music is right where you left it.'}</p>

      <form onSubmit={handleSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          disabled={loading}
        />

        <label htmlFor="password">Password</label>
        <div className="password-field">
        <input
          id="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          disabled={loading}
        />

        <button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} disabled={loading}>
          {showPassword ? 'Hide' : 'Show'}
        </button>
        </div>

        <button type="submit" disabled={loading}>
          {loading
            ? 'Please wait…'
            : isSignup
              ? 'Create account'
              : 'Sign in'}
        </button>

        <p role="status">{message}</p>
      </form>

      <div className="auth-switch">
        {isSignup ? 'Already have an account?' : 'New to sound garden?'}{' '}
        <button type="button" onClick={onSwitch} disabled={loading}>
          {isSignup ? 'Sign in' : 'Create an account'}
        </button>
      </div>
      <button type="button" onClick={onClose} disabled={loading}>
        Back
      </button>
    </section>
  )
}
