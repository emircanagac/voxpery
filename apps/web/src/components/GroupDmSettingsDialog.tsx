import { useState, type FormEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { LogOut, UserMinus, UserPlus } from 'lucide-react'
import ModalSurface from './ModalSurface'
import { resolveAvatarUrl, type DmChannel } from '../api'
import { MAX_GROUP_DM_MEMBERS, MAX_GROUP_DM_NAME_CHARS } from './DmFriendPicker'
import type { StatusValue } from './StatusIcon'

type Props = {
  channel: DmChannel
  currentUserId: string
  busy?: boolean
  onRename: (name: string) => void
  onRemoveMember: (userId: string) => void
  onAddMembers: () => void
  onLeave: () => void
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}

export default function GroupDmSettingsDialog({
  channel,
  currentUserId,
  busy = false,
  onRename,
  onRemoveMember,
  onAddMembers,
  onLeave,
  onClose,
  returnFocusRef,
}: Props) {
  const [name, setName] = useState(channel.name ?? '')
  const [confirmLeave, setConfirmLeave] = useState(false)
  const members = channel.members ?? []
  const isOwner = channel.owner_id === currentUserId
  const nameChanged = name.trim() !== (channel.name ?? '')
  const roomLeft = MAX_GROUP_DM_MEMBERS - members.length

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !nameChanged) return
    onRename(name.trim())
  }

  return createPortal(
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <ModalSurface
        as="form"
        name="Group settings"
        className="modal dm-group-settings-modal"
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
        <h2>Group settings</h2>
        <div className="form-group">
          <label htmlFor="dm-group-name">Group name</label>
          <div className="dm-group-name-row">
            <input
              id="dm-group-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={MAX_GROUP_DM_NAME_CHARS}
              placeholder="Members' names"
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !nameChanged}>Save</button>
          </div>
        </div>
        <div className="dm-group-members-header">
          <h3>{`Members · ${members.length}/${MAX_GROUP_DM_MEMBERS}`}</h3>
          <button
            type="button"
            className="btn btn-secondary dm-group-add"
            onClick={onAddMembers}
            disabled={busy || roomLeft <= 0}
            title={roomLeft <= 0 ? 'This group is full' : undefined}
          >
            <UserPlus size={14} aria-hidden="true" />
            Add members
          </button>
        </div>
        <ul className="dm-picker-list dm-group-members" aria-label="Group members">
          {members.map((member) => (
            <li key={member.id} className="dm-picker-row">
              <span className={`home-member-avatar avatar-status-${(member.status ?? 'offline') as StatusValue}`} aria-hidden="true">
                {member.avatar_url
                  ? <img src={resolveAvatarUrl(member.avatar_url) ?? ''} alt="" />
                  : member.username.charAt(0).toUpperCase()}
              </span>
              <span className="dm-picker-name">
                {member.username}
                {member.id === currentUserId && <span className="dm-group-you"> (you)</span>}
              </span>
              {member.id === channel.owner_id && (
                <span className="dm-group-owner">Owner</span>
              )}
              {isOwner && member.id !== currentUserId && (
                <button
                  type="button"
                  className="home-member-action"
                  aria-label={`Remove ${member.username} from the group`}
                  title="Remove from group"
                  disabled={busy}
                  onClick={() => onRemoveMember(member.id)}
                >
                  <UserMinus size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          {confirmLeave ? (
            <>
              <span className="dm-group-leave-confirm">Leave this group?</span>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmLeave(false)} disabled={busy}>
                Stay
              </button>
              <button type="button" className="btn btn-danger" onClick={onLeave} disabled={busy}>
                {busy ? 'Leaving…' : 'Leave group'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-danger dm-group-leave" onClick={() => setConfirmLeave(true)} disabled={busy}>
                <LogOut size={14} aria-hidden="true" />
                Leave group
              </button>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
                Close
              </button>
            </>
          )}
        </div>
      </ModalSurface>
    </div>,
    document.body,
  )
}
