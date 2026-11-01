import type { SocialContextMenu } from './homeSocialModel'
import type { DmChannel, Friend } from '../api/contracts'
import type { CSSProperties, Dispatch, RefObject, SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { MessageCircle, Pin, Settings, UserMinus, UserRound, X } from 'lucide-react'
import { handleMenuKeyboardNavigation } from '../menuKeyboardNavigation'
import { type MemberProfileMember } from '../components/MemberProfileDialog'

interface HomeContextMenuProps {
  closeSocialContextMenu: (restoreFocus?: boolean) => void
  dmChannels: DmChannel[]
  friends: Friend[]
  handleHideDmChannel: (channelId: string) => Promise<void>
  handleToggleDmPinned: (channelId: string, pinned: boolean) => Promise<void>
  openDirectMessage: (peerId: string) => Promise<void>
  openingDmPeerId: string | null
  setGroupDmDialog: Dispatch<SetStateAction<{ kind: "settings" | "add"; channelId: string; } | null>>
  setProfileCard: Dispatch<SetStateAction<MemberProfileMember | null>>
  setRemoveFriendTarget: Dispatch<SetStateAction<Friend | null>>
  socialContextMenu: SocialContextMenu | null
  socialMenuRef: RefObject<HTMLDivElement | null>
  socialMenuStyle: CSSProperties
  updatingDmPreferenceId: string | null
}

export default function HomeContextMenu({
  closeSocialContextMenu,
  dmChannels,
  friends,
  handleHideDmChannel,
  handleToggleDmPinned,
  openDirectMessage,
  openingDmPeerId,
  setGroupDmDialog,
  setProfileCard,
  setRemoveFriendTarget,
  socialContextMenu,
  socialMenuRef,
  socialMenuStyle,
  updatingDmPreferenceId,
}: HomeContextMenuProps) {
  return (
    <>
      {socialContextMenu && (() => {
        const channel = socialContextMenu.channelId
          ? dmChannels.find((candidate) => candidate.id === socialContextMenu.channelId)
          : null
        const friend = friends.find((candidate) => candidate.id === socialContextMenu.userId)
        const profileMember: MemberProfileMember = {
          user_id: socialContextMenu.userId,
          username: socialContextMenu.username,
          avatar_url: socialContextMenu.avatarUrl,
          status: socialContextMenu.status,
          role: '',
        }
        return createPortal(
          <div
            className={`server-context-menu social-dm-context-menu${socialContextMenu.kind === 'friend' ? ' social-dm-context-menu--friend' : ''}`}
            role="menu"
            aria-label={`Actions for ${socialContextMenu.username}`}
            ref={socialMenuRef}
            style={socialMenuStyle}
            onKeyDown={handleMenuKeyboardNavigation}
            onClick={(event) => event.stopPropagation()}
          >
            {socialContextMenu.kind === 'group' && channel ? (
              <button
                type="button"
                className="server-context-menu-item"
                role="menuitem"
                autoFocus
                onClick={() => {
                  closeSocialContextMenu()
                  setGroupDmDialog({ kind: 'settings', channelId: channel.id })
                }}
              >
                <Settings size={14} />
                Group settings
              </button>
            ) : (
              <button
                type="button"
                className="server-context-menu-item"
                role="menuitem"
                autoFocus
                onClick={() => {
                  closeSocialContextMenu()
                  setProfileCard(profileMember)
                }}
              >
                <UserRound size={14} />
                <span className="social-context-action-label">View profile (@{socialContextMenu.username})</span>
              </button>
            )}
            {socialContextMenu.kind === 'friend' && (
              <button
                type="button"
                className="server-context-menu-item"
                role="menuitem"
                disabled={openingDmPeerId === socialContextMenu.userId}
                onClick={() => {
                  closeSocialContextMenu()
                  void openDirectMessage(socialContextMenu.userId)
                }}
              >
                <MessageCircle size={14} />
                Send message
              </button>
            )}
            {channel && (
              <button
                type="button"
                className="server-context-menu-item"
                role="menuitem"
                disabled={updatingDmPreferenceId === channel.id}
                onClick={() => {
                  closeSocialContextMenu()
                  void handleToggleDmPinned(channel.id, !channel.is_pinned)
                }}
              >
                <Pin size={14} />
                {channel.is_pinned ? 'Unpin Conversation' : 'Pin Conversation'}
              </button>
            )}
            {socialContextMenu.kind === 'friend' && friend && (
              <button
                type="button"
                className="server-context-menu-item danger"
                role="menuitem"
                onClick={() => {
                  closeSocialContextMenu()
                  setRemoveFriendTarget(friend)
                }}
              >
                <UserMinus size={14} />
                Remove friend
              </button>
            )}
            {channel && (
              <button
                type="button"
                className="server-context-menu-item danger"
                role="menuitem"
                onClick={() => {
                  closeSocialContextMenu()
                  void handleHideDmChannel(channel.id)
                }}
              >
                <X size={14} />
                Close DM
              </button>
            )}
          </div>,
          document.body,
        )
      })()}
    </>
  )
}
