import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { NavigateFunction } from 'react-router'
import { ArrowRight, Settings, Users } from 'lucide-react'
import type { DmChannel, Friend, Message, Server, UserPublic } from '../api'
import ChatArea from './ChatArea'
import OnboardingCard from './OnboardingCard'
import { ROUTES } from '../routes'
import { createReplyContentSnippet } from '../replyPreview'
import { setPersistedSocialView, type SocialView } from '../socialView'
import type { FriendsFilter } from '../friendsList'
import type { CachedDmMessage } from '../dmMessageCache'
import type { DraftAttachmentItem } from '../draftAttachments'

/** Everything DmConversation reads or changes; the state itself stays in its parent. */
export type DmConversationProps = {
  activeDmChannelId: string | null
  storeDmChannels: DmChannel[]
  showSocialBootstrapLoading: boolean
  friends: Friend[]
  setView: Dispatch<SetStateAction<SocialView>>
  setFriendsFilter: Dispatch<SetStateAction<FriendsFilter>>
  voxperyServer: Server | null
  openOfficialCommunity: () => Promise<void>
  user: UserPublic | null
  displayedDmMessages: CachedDmMessage[]
  dmHasMoreOlder: boolean
  dmLoadingOlder: boolean
  loadOlderDmMessages: () => Promise<void>
  dmConversationReady: boolean
  isNotificationHistoryPending: boolean
  dmUnreadDividerCount: number
  dmDraftAttachments: DraftAttachmentItem[]
  dmInput: string
  handleDmAttachmentPick: (files: FileList | null) => Promise<void>
  setDmDraftAttachments: Dispatch<SetStateAction<DraftAttachmentItem[]>>
  handleRetryDmAttachment: (localId: string) => Promise<void>
  handleDmInputChange: (value: string) => void
  handleSendDm: (_e?: FormEvent<Element> | undefined, forceContent?: string | undefined) => Promise<void>
  handleRetryDmMessage: (clientId: string) => Promise<void>
  setDeleteDmConfirmMessageId: Dispatch<SetStateAction<string | null>>
  editingDmMessageId: string | null
  editingDmContent: string
  setEditingDmMessageId: Dispatch<SetStateAction<string | null>>
  setEditingDmContent: Dispatch<SetStateAction<string>>
  saveDmEdit: () => Promise<void>
  replyingToDm: { id: string; username: string; contentSnippet: string; } | null
  setReplyingToDm: Dispatch<SetStateAction<{ id: string; username: string; contentSnippet: string; } | null>>
  isMessagesView: boolean
  dmSearch: string
  setDmSearch: Dispatch<SetStateAction<string>>
  dmPins: Message[]
  handlePinDmMessage: (messageId: string) => Promise<void>
  handleUnpinDmMessage: (messageId: string) => Promise<void>
  handleToggleDmReaction: (messageId: string, emoji: string, reacted: boolean) => Promise<void>
  setGroupDmDialog: Dispatch<SetStateAction<{ kind: "settings" | "add"; channelId: string; } | null>>
  notificationJumpMessageId: string | null
  dmSearchJump: { channelId: string; messageId: string; } | null
  handleDmNotificationAnchorVisible: () => void
  setDmSearchJump: Dispatch<SetStateAction<{ channelId: string; messageId: string; } | null>>
  dmSearchResults: Message[] | null
  goToDmSearchResult: (messageId: string) => Promise<void>
  dmSearchJumpLoadingId: string | null
  navigate: NavigateFunction
}

/** The open direct or group conversation in the Home view, or its empty and loading states. */
export default function DmConversation(props: DmConversationProps) {
  const {
    activeDmChannelId,
    storeDmChannels,
    showSocialBootstrapLoading,
    friends,
    setView,
    setFriendsFilter,
    voxperyServer,
    openOfficialCommunity,
    user,
    displayedDmMessages,
    dmHasMoreOlder,
    dmLoadingOlder,
    loadOlderDmMessages,
    dmConversationReady,
    isNotificationHistoryPending,
    dmUnreadDividerCount,
    dmDraftAttachments,
    dmInput,
    handleDmAttachmentPick,
    setDmDraftAttachments,
    handleRetryDmAttachment,
    handleDmInputChange,
    handleSendDm,
    handleRetryDmMessage,
    setDeleteDmConfirmMessageId,
    editingDmMessageId,
    editingDmContent,
    setEditingDmMessageId,
    setEditingDmContent,
    saveDmEdit,
    replyingToDm,
    setReplyingToDm,
    isMessagesView,
    dmSearch,
    setDmSearch,
    dmPins,
    handlePinDmMessage,
    handleUnpinDmMessage,
    handleToggleDmReaction,
    setGroupDmDialog,
    notificationJumpMessageId,
    dmSearchJump,
    handleDmNotificationAnchorVisible,
    setDmSearchJump,
    dmSearchResults,
    goToDmSearchResult,
    dmSearchJumpLoadingId,
    navigate,
  } = props
  const dmChannel = activeDmChannelId ? storeDmChannels.find((c) => c.id === activeDmChannelId) : null
  if (showSocialBootstrapLoading) {
    return (
      <div className="home-dm-chat">
        <div className="home-list-skeleton" aria-hidden="true" style={{ padding: 24 }}>
          <div className="home-list-skeleton-row" />
          <div className="home-list-skeleton-row" />
          <div className="home-list-skeleton-row" />
        </div>
      </div>
    )
  }
  if (!dmChannel) {
    return (
      <div className="home-dm-chat">
        <div className="welcome-screen" style={{ padding: 24 }}>
          <OnboardingCard
            title="Start a conversation"
            description={
              friends.length > 0
                ? 'Pick a friend from the sidebar or jump back to Friends to start your first DM.'
                : 'You need at least one friend before you can start a DM.'
            }
            actions={[
              {
                label: friends.length > 0 ? 'Open friends' : 'Add a friend',
                onClick: () => {
                  setView('friends')
                  setPersistedSocialView('friends')
                  setFriendsFilter(friends.length > 0 ? 'all' : 'requests')
                },
                icon: <Users size={14} />,
              },
              {
                label: voxperyServer ? 'Open community' : 'Join community',
                onClick: () => {
                  void openOfficialCommunity()
                },
                variant: 'secondary',
                icon: <ArrowRight size={14} />,
              },
            ]}
          />
        </div>
      </div>
    )
  }
  const isGroupDm = !!dmChannel.is_group
  const groupMembers = dmChannel.members ?? []
  const syntheticChannel = {
    id: dmChannel.id,
    server_id: '',
    name: dmChannel.peer_username,
    channel_type: 'text' as const,
    position: 0,
    description: isGroupDm ? `${groupMembers.length} members` : null,
  }
  const dmMentionUsers = isGroupDm
    ? groupMembers.map((member) => ({ user_id: member.id, username: member.username, avatar_url: member.avatar_url, status: member.status }))
    : [
        { user_id: dmChannel.peer_id, username: dmChannel.peer_username, avatar_url: dmChannel.peer_avatar_url, status: dmChannel.peer_status },
        ...(user ? [{ user_id: user.id, username: user.username, avatar_url: user.avatar_url ?? null, status: user.status }] : []),
      ]
  return (
    <ChatArea
      activeChannel={syntheticChannel}
      messages={displayedDmMessages}
      hasMoreOlder={dmHasMoreOlder}
      loadingOlder={dmLoadingOlder}
      onLoadOlder={loadOlderDmMessages}
      loading={(!dmConversationReady || isNotificationHistoryPending)
        && (displayedDmMessages.length === 0 || isNotificationHistoryPending)}
      unreadDividerCount={dmUnreadDividerCount}
      draftAttachments={dmDraftAttachments}
      messageInput={dmInput}
      onPickAttachments={handleDmAttachmentPick}
      onRemoveAttachment={(index) => setDmDraftAttachments((prev) => prev.filter((_, i) => i !== index))}
      onRetryAttachment={handleRetryDmAttachment}
      onMessageInputChange={handleDmInputChange}
      onSendMessage={handleSendDm}
      onRetryMessage={handleRetryDmMessage}
      onDeleteMessage={setDeleteDmConfirmMessageId}
      editingMessageId={editingDmMessageId}
      editingContent={editingDmContent}
      onEditMessage={(msg) => {
        setEditingDmMessageId(msg.id)
        setEditingDmContent(msg.contentToEdit ?? msg.content)
      }}
      onEditingContentChange={setEditingDmContent}
      onSaveEdit={saveDmEdit}
      onCancelEdit={() => {
        setEditingDmMessageId(null)
        setEditingDmContent('')
      }}
      currentUserId={user?.id ?? null}
      isDm
      mentionUsers={dmMentionUsers}
      replyingTo={replyingToDm}
      onCancelReply={() => setReplyingToDm(null)}
      onReplyToMessage={(msg) => {
        const username = msg.author?.username ?? 'User'
        const snippet = createReplyContentSnippet(msg.content)
        setReplyingToDm({ id: msg.id, username, contentSnippet: snippet })
      }}
      isViewActive={isMessagesView}
      searchQuery={dmSearch}
      onSearchChange={setDmSearch}
      pinnedMessages={dmPins}
      onPinMessage={handlePinDmMessage}
      onUnpinMessage={handleUnpinDmMessage}
      onToggleReaction={handleToggleDmReaction}
      emptyStateTitle={isGroupDm ? `Welcome to ${dmChannel.peer_username}` : `Start your conversation with ${dmChannel.peer_username}`}
      emptyStateDescription={isGroupDm ? 'This is the beginning of this group conversation.' : 'This is the beginning of your direct message history.'}
      headerActions={isGroupDm ? (
        <button
          type="button"
          className="chat-header-member-btn"
          onClick={() => setGroupDmDialog({ kind: 'settings', channelId: dmChannel.id })}
          title="Group settings"
          aria-label="Group settings"
        >
          <Settings size={17} />
        </button>
      ) : undefined}
      jumpToMessageId={notificationJumpMessageId
        ?? (dmSearchJump?.channelId === activeDmChannelId ? dmSearchJump.messageId : null)}
      onJumpToMessageHandled={notificationJumpMessageId ? handleDmNotificationAnchorVisible : () => setDmSearchJump(null)}
      searchResults={dmSearch.trim() ? dmSearchResults : null}
      searchScopeLabel="this conversation"
      onGoToSearchResult={(messageId) => { void goToDmSearchResult(messageId) }}
      searchJumpingMessageId={dmSearchJumpLoadingId}
      onOpenInviteLink={(code) => navigate(ROUTES.invite(code))}
    />
  )
}
