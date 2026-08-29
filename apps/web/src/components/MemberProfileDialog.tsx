import { MessageCircle, UserPlus, X } from 'lucide-react'
import { resolveAvatarUrl } from '../api'

export interface MemberProfileMember {
  user_id: string
  username: string
  role: string
  avatar_url?: string | null
  about_me?: string | null
  status?: string | null
  role_color?: string | null
  roles?: string[]
  account_created_at?: string | null
  server_joined_at?: string | null
}

interface MemberProfileDialogProps {
  member: MemberProfileMember
  isServerOwner: boolean
  onClose: () => void
  actions?: {
    canSendDm: boolean
    canAddFriend: boolean
    onSendDm?: () => void
    onAddFriend?: () => void
  }
}

function formatProfileDate(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

export default function MemberProfileDialog({ member, isServerOwner, onClose, actions }: MemberProfileDialogProps) {
  const baseRoleNormalized = member.role.trim().toLowerCase()
  const roleSet = new Set<string>()
  for (const roleName of member.roles ?? []) {
    const trimmed = roleName.trim()
    if (!trimmed) continue
    const normalized = trimmed.toLowerCase()
    if (normalized === 'owner' || normalized === baseRoleNormalized) continue
    roleSet.add(trimmed)
  }
  const roleLabels = Array.from(roleSet)
  const showBaseRoleBadge = baseRoleNormalized.length > 0
    && baseRoleNormalized !== 'member'
    && !(isServerOwner && baseRoleNormalized === 'owner')
  const aboutMe = member.about_me?.trim()
  const accountCreatedAt = formatProfileDate(member.account_created_at)
  const serverJoinedAt = formatProfileDate(member.server_joined_at)

  return (
    <div className="modal-overlay member-profile-dialog-overlay" onClick={onClose}>
      <section
        className="member-profile-popout member-profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-profile-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="member-profile-dialog-close"
          aria-label="Close profile"
          title="Close profile"
          onClick={onClose}
        >
          <X size={16} />
        </button>
        <div className="member-profile-header">
          <div className="member-profile-avatar">
            {member.avatar_url ? (
              <img src={resolveAvatarUrl(member.avatar_url) ?? ''} alt="" className="member-avatar-image" />
            ) : (
              member.username.charAt(0).toUpperCase()
            )}
          </div>
          <div className="member-profile-meta">
            <div id="member-profile-dialog-title" className="member-profile-username">{member.username}</div>
            <div className="member-profile-status">{(member.status ?? 'offline').toString().toUpperCase()}</div>
          </div>
        </div>
        <div className="member-profile-badges">
          {isServerOwner && <span className="member-profile-badge is-owner">Owner</span>}
          {showBaseRoleBadge && (
            <span
              className="member-profile-badge"
              style={member.role_color ? { borderColor: member.role_color, color: member.role_color } : undefined}
            >
              {member.role}
            </span>
          )}
        </div>
        {actions && (actions.canSendDm || actions.canAddFriend) && (
          <div className="member-profile-actions" role="group" aria-label={`Actions for ${member.username}`}>
            {actions.canSendDm && actions.onSendDm && (
              <button type="button" className="member-profile-action" onClick={actions.onSendDm}>
                <MessageCircle size={14} />
                Send DM
              </button>
            )}
            {actions.canAddFriend && actions.onAddFriend && (
              <button type="button" className="member-profile-action" onClick={actions.onAddFriend}>
                <UserPlus size={14} />
                Add friend
              </button>
            )}
          </div>
        )}
        {aboutMe && (
          <div className="member-profile-section">
            <div className="member-profile-section-title">About me</div>
            <div className="member-profile-about">{aboutMe}</div>
          </div>
        )}
        {(accountCreatedAt || serverJoinedAt) && (
          <div className="member-profile-dates" aria-label="Profile dates">
            {accountCreatedAt && (
              <div className="member-profile-date">
                <span>Member since</span>
                <strong>{accountCreatedAt}</strong>
              </div>
            )}
            {serverJoinedAt && (
              <div className="member-profile-date">
                <span>Joined server</span>
                <strong>{serverJoinedAt}</strong>
              </div>
            )}
          </div>
        )}
        {roleLabels.length > 0 && (
          <div className="member-profile-section">
          <div className="member-profile-section-title">Roles in server</div>
            <div className="member-profile-badges member-profile-badges--stack">
              {roleLabels.map((label) => (
                <span
                  key={label}
                  className="member-profile-badge"
                  style={member.role_color ? { borderColor: member.role_color, color: member.role_color } : undefined}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
