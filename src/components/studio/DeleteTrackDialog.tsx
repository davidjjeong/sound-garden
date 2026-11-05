import { useEffect, useRef } from 'react'

type Props = {
  title: string
  isDeleting: boolean
  error: string
  onClose: () => void
  onConfirm: () => void
}

export function DeleteTrackDialog({ title, isDeleting, error, onClose, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    cancel.current?.focus()
    return () => { element?.close() }
  }, [])
  return (
    <dialog ref={dialog} className="delete-dialog" aria-labelledby="delete-title"
      aria-describedby="delete-description" aria-busy={isDeleting}
      onCancel={(event) => { event.preventDefault(); if (!isDeleting) onClose() }}>
      <div className="delete-dialog-icon" aria-hidden="true"><TrashIcon /></div>
      <h2 id="delete-title">Delete track?</h2>
      <p id="delete-description">“{title}” will be permanently removed from your library and storage.</p>
      {error && <p className="delete-error" role="alert">{error}</p>}
      {isDeleting && <p role="status">Deleting your track…</p>}
      <div className="delete-dialog-actions">
        <button ref={cancel} type="button" onClick={onClose} disabled={isDeleting}>
          {error ? 'Close' : 'Cancel'}
        </button>
        <button className="delete-confirm" type="button" onClick={onConfirm} disabled={isDeleting}>
          {isDeleting ? <><span className="delete-spinner" aria-hidden="true" /> Deleting…</> : error ? 'Retry deletion' : 'Delete track'}
        </button>
      </div>
    </dialog>
  )
}

export function TrashIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />
  </svg>
}
