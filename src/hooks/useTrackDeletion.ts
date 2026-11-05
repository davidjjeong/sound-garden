import { useEffect, useRef, useState } from 'react'
import { deleteTrack } from '../lib/tracks'

type DeletionTarget = { id: string; title: string }

export function useTrackDeletion() {
  const [target, setTarget] = useState<DeletionTarget | null>(null)
  const [isOpen, setOpen] = useState(false)
  const [isDeleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const targetRef = useRef<DeletionTarget | null>(null)
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  function choose(track: DeletionTarget) {
    // Keep an uncertain attempt until resolved instead of replacing its ID.
    if (busy.current || targetRef.current) return
    targetRef.current = track
    setTarget(track)
    setError('')
    setOpen(true)
  }
  function close() {
    if (busy.current) return
    setOpen(false)
    if (!error) {
      targetRef.current = null
      setTarget(null)
    }
  }
  function reopen() { if (targetRef.current) setOpen(true) }
  async function confirm(): Promise<string | null> {
    if (busy.current || !targetRef.current || !mounted.current) return null
    const attempt = targetRef.current
    busy.current = true
    setDeleting(true)
    setError('')
    try {
      const id = await deleteTrack(attempt.id)
      if (!mounted.current) return null
      targetRef.current = null
      setTarget(null)
      setOpen(false)
      return id
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'Deletion failed. Please retry.')
      return null
    } finally {
      busy.current = false
      if (mounted.current) setDeleting(false)
    }
  }
  return { target, isOpen, isDeleting, error, choose, close, reopen, confirm }
}
