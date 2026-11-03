import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let receivedEvent = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        receivedEvent = true
        if (!active) return
        setSession(nextSession)
        setError(null)
        setLoading(false)
      },
    )

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active || receivedEvent) return
      setSession(data.session)
      setError(sessionError?.message ?? null)
      setLoading(false)
    }).catch(() => {
      if (!active || receivedEvent) return
      setError('Unable to restore your session. Please reload and try again.')
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  return { user: session?.user ?? null, loading, error }
}
