import { useEffect, useRef, useState } from 'react'
import { userNoteApi } from '../api'
import { useAuthStore } from '../stores/auth'

const MAX_NOTE_LENGTH = 1000

interface MemberNoteFieldProps {
  userId: string
  username: string
  autoFocus?: boolean
}

/** The viewer's private note about a member; saved on blur and when the profile closes. */
export default function MemberNoteField({ userId, username, autoFocus }: MemberNoteFieldProps) {
  const token = useAuthStore((state) => state.token)
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'saved' | 'failed'>('loading')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const savedRef = useRef('')
  const draftRef = useRef('')
  const loadedRef = useRef(false)

  useEffect(() => {
    let active = true
    userNoteApi.get(userId, token)
      .then((result) => {
        if (!active) return
        savedRef.current = result.note ?? ''
        draftRef.current = result.note ?? ''
        loadedRef.current = true
        setNote(result.note ?? '')
        setStatus('ready')
      })
      .catch(() => { if (active) setStatus('failed') })
    return () => { active = false }
  }, [userId, token])

  const loaded = status !== 'loading'
  useEffect(() => {
    if (loaded && autoFocus) inputRef.current?.focus()
  }, [loaded, autoFocus])

  const saveRef = useRef(async () => false)
  useEffect(() => {
    saveRef.current = async () => {
      const value = draftRef.current.trim()
      if (!loadedRef.current || value === savedRef.current) return false
      await userNoteApi.save(userId, value, token)
      savedRef.current = value
      return true
    }
  }, [userId, token])
  useEffect(() => () => { void saveRef.current().catch(() => { }) }, [])

  return (
    <div className="member-profile-section">
      <label className="member-profile-section-title" htmlFor="member-profile-note">Note</label>
      <textarea
        id="member-profile-note"
        ref={inputRef}
        className="member-profile-note-input"
        rows={2}
        maxLength={MAX_NOTE_LENGTH}
        placeholder={`Add a note about ${username}`}
        value={note}
        disabled={status === 'loading'}
        onChange={(event) => {
          draftRef.current = event.target.value
          setNote(event.target.value)
          setStatus('ready')
        }}
        onBlur={() => {
          saveRef.current()
            .then((saved) => { if (saved) setStatus('saved') })
            .catch(() => setStatus('failed'))
        }}
      />
      <div className="member-profile-note-hint" role="status">
        {status === 'failed' ? 'Could not sync this note. Try again.' : status === 'saved' ? 'Saved. Only you can see this note.' : 'Only you can see this note.'}
      </div>
    </div>
  )
}
