import { useMemo, useState, type FormEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, Search } from 'lucide-react'
import ModalSurface from './ModalSurface'
import { resolveAvatarUrl, type Friend } from '../api'
import { compareFriendsForList } from '../friendsList'
import type { StatusValue } from './StatusIcon'

/** Group DMs hold at most this many people, the creator included (matches the server). */
export const MAX_GROUP_DM_MEMBERS = 8
export const MAX_GROUP_DM_NAME_CHARS = 64

type Props = {
  /** `new`: one friend opens a DM, several create a group. `add`: add friends to a group. */
  mode: 'new' | 'add'
  friends: Friend[]
  /** People already in the group; they are left out of the list. */
  excludeIds?: string[]
  /** How many more people fit (defaults to a new group's room). */
  capacity?: number
  busy?: boolean
  onSubmit: (selectedIds: string[], groupName: string) => void
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}

export default function DmFriendPicker({
  mode,
  friends,
  excludeIds = [],
  capacity = MAX_GROUP_DM_MEMBERS - 1,
  busy = false,
  onSubmit,
  onClose,
  returnFocusRef,
}: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [groupName, setGroupName] = useState('')

  const candidates = useMemo(
    () => friends.filter((friend) => !excludeIds.includes(friend.id)).sort(compareFriendsForList),
    [excludeIds, friends],
  )
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? candidates.filter((friend) => friend.username.toLowerCase().includes(needle)) : candidates
  }, [candidates, query])

  const isGroup = mode === 'add' || selected.length > 1
  const full = selected.length >= capacity
  const title = mode === 'add' ? 'Add members' : 'New message'
  const submitLabel = mode === 'add'
    ? (busy ? 'Adding…' : 'Add')
    : isGroup
      ? (busy ? 'Creating…' : 'Create group')
      : (busy ? 'Opening…' : 'Open DM')

  const toggle = (id: string) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id)
      return current.length >= capacity ? current : [...current, id]
    })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || selected.length === 0) return
    onSubmit(selected, groupName.trim())
  }

  const emptyMessage = friends.length === 0
    ? 'You have no friends yet. Add a friend to start a conversation.'
    : candidates.length === 0
      ? 'All your friends are already in this group.'
      : 'No friends match your search.'

  return createPortal(
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <ModalSurface
        as="form"
        name={title}
        className="modal dm-picker-modal"
        returnFocusRef={returnFocusRef}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation()
            onClose()
          }
        }}
        onSubmit={handleSubmit}
      >
        <h2>{title}</h2>
        <p className="dm-picker-hint">
          {mode === 'add'
            ? `Pick friends to add. ${capacity} more ${capacity === 1 ? 'person fits' : 'people fit'} in this group.`
            : `Pick one friend for a direct message, or up to ${capacity} for a group.`}
        </p>
        {candidates.length > 0 && (
          <label className="dm-picker-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search friends"
              aria-label="Search friends"
              autoComplete="off"
            />
          </label>
        )}
        {visible.length === 0 ? (
          <div className="dm-picker-empty" role="status">{emptyMessage}</div>
        ) : (
          <ul className="dm-picker-list" aria-label="Friends">
            {visible.map((friend) => {
              const checked = selected.includes(friend.id)
              return (
                <li key={friend.id}>
                  <label className={`dm-picker-row${checked ? ' selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && full}
                      onChange={() => toggle(friend.id)}
                    />
                    <span className={`home-member-avatar avatar-status-${(friend.status ?? 'offline') as StatusValue}`} aria-hidden="true">
                      {friend.avatar_url
                        ? <img src={resolveAvatarUrl(friend.avatar_url) ?? ''} alt="" />
                        : friend.username.charAt(0).toUpperCase()}
                    </span>
                    <span className="dm-picker-name">{friend.username}</span>
                    <span className="dm-picker-check" aria-hidden="true">{checked && <Check size={14} />}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
        {mode === 'new' && isGroup && (
          <div className="form-group dm-picker-name-field">
            <label htmlFor="dm-picker-group-name">Group name (optional)</label>
            <input
              id="dm-picker-group-name"
              type="text"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              maxLength={MAX_GROUP_DM_NAME_CHARS}
              placeholder="Members' names are shown when empty"
            />
          </div>
        )}
        <div className="modal-actions">
          <span className="dm-picker-count" aria-live="polite">
            {selected.length > 0 ? `${selected.length} selected` : ''}
          </span>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || selected.length === 0}>
            {submitLabel}
          </button>
        </div>
      </ModalSurface>
    </div>,
    document.body,
  )
}
