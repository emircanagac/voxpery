import { presenceLabel, type SocialContextMenu } from './homeSocialModel'
import type { SocialView } from '../socialView'
import type { MemberProfileMember } from '../components/MemberProfileDialog'
import type { FriendsFilter } from '../friendsList'
import type { DraftAttachmentItem } from '../draftAttachments'
import type { DmChannel, Friend, FriendRequest } from '../api/contracts'
import type { CachedDmMessage } from '../dmMessageCache'
import type { Dispatch, FormEvent, MouseEvent as ReactMouseEvent, RefObject, SetStateAction } from 'react'
import { Activity, Check, Compass, Inbox, MessageCircle, MessageSquarePlus, MoreHorizontal, Search, Send, UserPlus, Users, X } from 'lucide-react'
import { resolveAvatarUrl } from '../api'
import OnboardingCard from '../components/OnboardingCard'
import DmConversation from '../components/DmConversation'
import { formatBadgeCount } from '../formatUnreadBadgeCount'
import { normalizePresence } from '../friendsList'

interface HomeSocialContentProps {
  acceptRequest: (requestId: string) => Promise<void>
  activeDmChannelId: string | null
  addFriendInputRef: RefObject<HTMLInputElement | null>
  addFriendMessage: { text: string; tone: "success" | "error"; } | null
  addFriendUsername: string
  cancelOutgoingRequest: (requestId: string) => Promise<void>
  displayedDmMessages: CachedDmMessage[]
  dmConversationReady: boolean
  dmDraftAttachments: DraftAttachmentItem[]
  dmHasMoreOlder: boolean
  dmInput: string
  dmLoadingOlder: boolean
  dmPins: import("D:/project_codes/voxpery/apps/web/src/api").Message[]
  dmSearch: string
  dmSearchJump: { channelId: string; messageId: string; } | null
  dmSearchJumpLoadingId: string | null
  dmSearchResults: import("D:/project_codes/voxpery/apps/web/src/api").Message[] | null
  dmUnreadDividerCount: number
  editingDmContent: string
  editingDmMessageId: string | null
  friends: Friend[]
  friendsFilter: FriendsFilter
  friendsSearch: string
  friendsSearchRef: RefObject<HTMLInputElement | null>
  goToDmSearchResult: (messageId: string) => Promise<void>
  handleDmAttachmentPick: (files: FileList | null) => Promise<void>
  handleDmInputChange: (value: string) => void
  handleDmNotificationAnchorVisible: () => void
  handlePinDmMessage: (messageId: string) => Promise<void>
  handleRetryDmAttachment: (localId: string) => Promise<void>
  handleRetryDmMessage: (clientId: string) => Promise<void>
  handleSendDm: (_e?: FormEvent, forceContent?: string) => Promise<void>
  handleToggleDmReaction: (messageId: string, emoji: string, reacted: boolean) => Promise<void>
  handleUnpinDmMessage: (messageId: string) => Promise<void>
  incomingRequests: FriendRequest[]
  isMessagesView: boolean
  isNotificationHistoryPending: boolean
  loadOlderDmMessages: () => Promise<void>
  navigate: import("D:/project_codes/voxpery/apps/web/node_modules/react-router/dist/production/index").NavigateFunction
  notificationJumpMessageId: string | null
  onlineFriends: Friend[]
  openAddFriend: () => void
  openMessageForFriend: (peerId: string) => Promise<void>
  openOfficialCommunity: () => Promise<void>
  openSocialContextMenu: (event: ReactMouseEvent<HTMLElement>, target: Omit<SocialContextMenu, "x" | "y">) => void
  openingDmPeerId: string | null
  rejectRequest: (requestId: string) => Promise<void>
  replyingToDm: { id: string; username: string; contentSnippet: string; } | null
  requestQuery: string
  saveDmEdit: () => Promise<void>
  sendFriendRequest: () => Promise<void>
  sendingFriendRequest: boolean
  setAddFriendUsername: Dispatch<SetStateAction<string>>
  setDeleteDmConfirmMessageId: Dispatch<SetStateAction<string | null>>
  setDmDraftAttachments: Dispatch<SetStateAction<DraftAttachmentItem[]>>
  setDmSearch: Dispatch<SetStateAction<string>>
  setDmSearchJump: Dispatch<SetStateAction<{ channelId: string; messageId: string; } | null>>
  setEditingDmContent: Dispatch<SetStateAction<string>>
  setEditingDmMessageId: Dispatch<SetStateAction<string | null>>
  setFriendsFilter: Dispatch<SetStateAction<FriendsFilter>>
  setFriendsSearch: Dispatch<SetStateAction<string>>
  setGroupDmDialog: Dispatch<SetStateAction<{ kind: "settings" | "add"; channelId: string; } | null>>
  setProfileCard: Dispatch<SetStateAction<MemberProfileMember | null>>
  setReplyingToDm: Dispatch<SetStateAction<{ id: string; username: string; contentSnippet: string; } | null>>
  setView: Dispatch<SetStateAction<SocialView>>
  showSocialBootstrapLoading: boolean
  socialContentRef: RefObject<HTMLDivElement | null>
  storeDmChannels: DmChannel[]
  user: import("D:/project_codes/voxpery/apps/web/src/api").User | null
  view: SocialView
  visibleFriends: Friend[]
  visibleIncomingRequests: FriendRequest[]
  visibleOutgoingRequests: FriendRequest[]
  voxperyServer: import("D:/project_codes/voxpery/apps/web/src/api").Server | null
}

export default function HomeSocialContent({
  acceptRequest,
  activeDmChannelId,
  addFriendInputRef,
  addFriendMessage,
  addFriendUsername,
  cancelOutgoingRequest,
  displayedDmMessages,
  dmConversationReady,
  dmDraftAttachments,
  dmHasMoreOlder,
  dmInput,
  dmLoadingOlder,
  dmPins,
  dmSearch,
  dmSearchJump,
  dmSearchJumpLoadingId,
  dmSearchResults,
  dmUnreadDividerCount,
  editingDmContent,
  editingDmMessageId,
  friends,
  friendsFilter,
  friendsSearch,
  friendsSearchRef,
  goToDmSearchResult,
  handleDmAttachmentPick,
  handleDmInputChange,
  handleDmNotificationAnchorVisible,
  handlePinDmMessage,
  handleRetryDmAttachment,
  handleRetryDmMessage,
  handleSendDm,
  handleToggleDmReaction,
  handleUnpinDmMessage,
  incomingRequests,
  isMessagesView,
  isNotificationHistoryPending,
  loadOlderDmMessages,
  navigate,
  notificationJumpMessageId,
  onlineFriends,
  openAddFriend,
  openMessageForFriend,
  openOfficialCommunity,
  openSocialContextMenu,
  openingDmPeerId,
  rejectRequest,
  replyingToDm,
  requestQuery,
  saveDmEdit,
  sendFriendRequest,
  sendingFriendRequest,
  setAddFriendUsername,
  setDeleteDmConfirmMessageId,
  setDmDraftAttachments,
  setDmSearch,
  setDmSearchJump,
  setEditingDmContent,
  setEditingDmMessageId,
  setFriendsFilter,
  setFriendsSearch,
  setGroupDmDialog,
  setProfileCard,
  setReplyingToDm,
  setView,
  showSocialBootstrapLoading,
  socialContentRef,
  storeDmChannels,
  user,
  view,
  visibleFriends,
  visibleIncomingRequests,
  visibleOutgoingRequests,
  voxperyServer,
}: HomeSocialContentProps) {
  return (
    <>
      <div ref={socialContentRef} className={`social-content${view === 'dm' ? ' social-content-dm' : ' social-content--friends'}`}>
        {view === 'friends' && (
          <>
            <header className="friends-page-header">
              <div className="friends-page-title"><Users size={22} aria-hidden="true" /><h1>Friends</h1></div>
            </header>
            <div className="friends-toolbar">
            <div className="home-chip-row" role="group" aria-label="Friends filters">
              <button
                type="button"
                className={`home-chip ${friendsFilter === 'online' ? 'active' : ''}`}
                aria-pressed={friendsFilter === 'online'}
                onClick={() => setFriendsFilter('online')}
              >
                <Activity size={14} />
                <span className="home-chip-label">Online</span>
              </button>
              <button
                type="button"
                className={`home-chip ${friendsFilter === 'all' ? 'active' : ''}`}
                aria-pressed={friendsFilter === 'all'}
                onClick={() => setFriendsFilter('all')}
              >
                <Users size={14} />
                <span className="home-chip-label">All</span>
              </button>
              <button
                type="button"
                className={`home-chip ${friendsFilter === 'requests' ? 'active' : ''}`}
                aria-pressed={friendsFilter === 'requests'}
                aria-label={incomingRequests.length > 0 ? `Pending, ${incomingRequests.length} incoming friend request${incomingRequests.length === 1 ? '' : 's'}` : 'Pending'}
                onClick={() => { setFriendsSearch(''); setFriendsFilter('requests') }}
              >
                <Inbox size={14} />
                <span className="home-chip-label">Pending</span>
                {incomingRequests.length > 0 && (
                  <span className="home-chip-badge" aria-hidden="true" title={`${incomingRequests.length} incoming friend request${incomingRequests.length === 1 ? '' : 's'}`}>{formatBadgeCount(incomingRequests.length)}</span>
                )}
              </button>
              <button
                type="button"
                className={`home-chip ${friendsFilter === 'add' ? 'active' : ''}`}
                aria-pressed={friendsFilter === 'add'}
                onClick={openAddFriend}
              >
                <UserPlus size={14} />
                <span className="home-chip-label">Add Friend</span>
              </button>
            </div>
            {friendsFilter !== 'add' && <div className="friends-search">
              <Search size={16} aria-hidden="true" />
              <input ref={friendsSearchRef} type="search" aria-label={friendsFilter === 'requests' ? 'Search requests' : 'Search friends'}
                placeholder={friendsFilter === 'requests' ? 'Search requests' : 'Search friends'} value={friendsSearch}
                onChange={event => setFriendsSearch(event.target.value)}
                onKeyDown={event => { if (event.key === 'Escape' && friendsSearch) { event.stopPropagation(); setFriendsSearch('') } }} />
              <button type="button" title="Clear search" aria-label="Clear friends search" disabled={!friendsSearch}
                onClick={() => { setFriendsSearch(''); friendsSearchRef.current?.focus() }}><X size={14} aria-hidden="true" /></button>
            </div>}
            </div>
            {friendsFilter === 'add' ? (
              <div className="home-friends-scroll home-friends-scroll--requests">
                <div className="home-list-group home-requests-add-card">
                  <div className="home-list-title">Add a Friend</div>
                  <form className="home-add-row" aria-busy={sendingFriendRequest} onSubmit={event => { event.preventDefault(); void sendFriendRequest() }}>
                    <input
                      ref={addFriendInputRef}
                      aria-label="Friend username"
                      className="home-search"
                      placeholder="Enter username"
                      value={addFriendUsername}
                      disabled={sendingFriendRequest}
                      onChange={(e) => setAddFriendUsername(e.target.value)}
                    />
                    <button type="submit" className="home-send-request-btn" disabled={!addFriendUsername.trim() || sendingFriendRequest}>
                      <Send size={14} aria-hidden="true" />
                      <span>{sendingFriendRequest ? 'Sending...' : 'Send Request'}</span>
                    </button>
                  </form>
                  {addFriendMessage && <div className={`home-empty-row home-add-message is-${addFriendMessage.tone}`} role={addFriendMessage.tone === 'error' ? 'alert' : 'status'}>{addFriendMessage.text}</div>}
                </div>
              </div>
            ) : friendsFilter === 'requests' ? (
              <div className="home-friends-scroll home-friends-scroll--requests">
                <div className="home-list-group">
                  <div className="home-list-title home-list-title-with-icon">
                    <Inbox size={16} />
                    <span>Incoming</span>
                    <span className="home-list-count">{formatBadgeCount(visibleIncomingRequests.length)}</span>
                  </div>
                  {visibleIncomingRequests.length === 0 ? (
                    <div className="home-empty-row home-empty-muted">{requestQuery ? 'No matching incoming requests.' : 'No incoming requests.'}</div>
                  ) : (
                    visibleIncomingRequests.map((r) => (
                      <div key={r.id} className="home-request-row">
                        <span className="friends-request-person">
                          <span className="friends-request-avatar" aria-hidden="true">{r.requester_username.charAt(0).toUpperCase()}</span>
                          <span title={r.requester_username}>{r.requester_username}</span>
                        </span>
                        <div className="home-request-actions">
                          <button
                            type="button"
                            className="home-request-btn accept"
                            aria-label={`Accept friend request from ${r.requester_username}`}
                            title="Accept request"
                            onClick={() => acceptRequest(r.id)}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            className="home-request-btn reject"
                            aria-label={`Reject friend request from ${r.requester_username}`}
                            title="Reject request"
                            onClick={() => rejectRequest(r.id)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  <div className="home-list-title home-list-title-with-icon home-list-title-secondary">
                    <Send size={16} />
                    <span>Outgoing</span>
                    <span className="home-list-count">{formatBadgeCount(visibleOutgoingRequests.length)}</span>
                  </div>
                  {visibleOutgoingRequests.length === 0 ? (
                    <div className="home-empty-row home-empty-muted">{requestQuery ? 'No matching outgoing requests.' : 'No outgoing requests.'}</div>
                  ) : (
                    visibleOutgoingRequests.map((r) => (
                      <div key={`out-${r.id}`} className="home-request-row home-request-row-outgoing">
                        <span className="friends-request-person">
                          <span className="friends-request-avatar" aria-hidden="true">{r.receiver_username.charAt(0).toUpperCase()}</span>
                          <span className="friends-request-copy"><strong title={r.receiver_username}>{r.receiver_username}</strong><span>Pending request</span></span>
                        </span>
                        <div className="home-request-actions">
                          <button
                            type="button"
                            className="home-request-btn reject"
                            title="Cancel request"
                            aria-label={`Cancel request to ${r.receiver_username}`}
                            onClick={() => void cancelOutgoingRequest(r.id)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="home-friends-scroll">
                <div className="home-list-group">
                  <div className="home-list-title">
                    {friendsFilter === 'online'
                      ? `Online Friends — ${visibleFriends.length}`
                      : `All Friends — ${visibleFriends.length}`}
                    {requestQuery && <> <span className="friends-filter-total">of {friendsFilter === 'online' ? onlineFriends.length : friends.length}</span></>}
                  </div>
                  {showSocialBootstrapLoading ? (
                    <div className="home-list-skeleton" aria-hidden="true">
                      <div className="home-list-skeleton-row" />
                      <div className="home-list-skeleton-row" />
                      <div className="home-list-skeleton-row" />
                    </div>
                  ) : visibleFriends.length === 0 ? (
                    requestQuery ? (
                      <div className="friends-empty-state"><Search size={28} aria-hidden="true" /><h3>No matching friends</h3><button type="button" className="btn btn-secondary" onClick={() => { setFriendsSearch(''); friendsSearchRef.current?.focus() }}>Clear search</button></div>
                    ) : friends.length === 0 ? (
                      <OnboardingCard
                        title="No friends yet"
                        description="Your friend list is empty."
                        actions={[
                          {
                            label: 'Add a friend',
                            onClick: openAddFriend,
                            icon: <MessageSquarePlus size={14} />,
                          },
                          {
                            label: voxperyServer ? 'Open community' : 'Join community',
                            onClick: () => {
                              void openOfficialCommunity()
                            },
                            variant: 'secondary',
                            icon: <Compass size={14} />,
                          },
                        ]}
                      />
                    ) : (
                      <div className="friends-empty-state"><Users size={28} aria-hidden="true" /><h3>
                        {friendsFilter === 'online'
                          ? "No one's online right now."
                          : 'No friends found for this view.'}
                      </h3><button type="button" className="btn btn-secondary" onClick={() => setFriendsFilter('all')}>Show everyone</button></div>
                    )
                  ) : (
                    visibleFriends.map((friend) => {
                      return (
                        <div
                          key={friend.id}
                          className={`home-member-row is-clickable ${openingDmPeerId === friend.id ? 'is-loading' : ''}`}
                          aria-disabled={openingDmPeerId === friend.id}
                          onContextMenu={(event) => {
                            openSocialContextMenu(event, {
                              kind: 'friend',
                              userId: friend.id,
                              username: friend.username,
                              avatarUrl: friend.avatar_url,
                              status: friend.status,
                            })
                          }}
                        >
                          <button
                            type="button"
                            className="home-member-profile-button"
                            aria-label={`View profile for ${friend.username}`}
                            onClick={() => setProfileCard({ user_id: friend.id, username: friend.username, avatar_url: friend.avatar_url, status: friend.status, role: '' })}
                          >
                            <div className={`home-member-avatar avatar-status-${['online', 'dnd', 'offline'].includes((friend.status ?? '').toLowerCase()) ? (friend.status ?? 'offline').toLowerCase() : 'offline'}`}>
                              {friend.avatar_url ? (
                                <img src={resolveAvatarUrl(friend.avatar_url) ?? ''} alt="" loading="lazy" decoding="async" />
                              ) : (
                                friend.username.charAt(0).toUpperCase()
                              )}
                            </div>
                          </button>
                          <button
                            type="button"
                            className="home-member-main"
                            aria-label={`Message ${friend.username}`}
                            disabled={openingDmPeerId === friend.id}
                            onClick={() => void openMessageForFriend(friend.id)}
                          >
                            <div className="home-member-meta">
                              <div title={friend.username}>{friend.username}</div>
                              <span>
                                <span title={presenceLabel(friend.status)} className={`home-presence-pill home-presence-pill-${normalizePresence(friend.status)}`}>
                                  <span className="home-presence-pill-dot" aria-hidden />
                                  {presenceLabel(friend.status)}
                                </span>
                              </span>
                            </div>
                          </button>
                          <div className="home-member-actions">
                            <button type="button" className="home-member-action home-member-action--message"
                              title={`Send a message to ${friend.username}`} tabIndex={-1} aria-hidden="true"
                              disabled={openingDmPeerId !== null} onClick={() => void openMessageForFriend(friend.id)}>
                              <MessageCircle size={17} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="home-member-action"
                              title={`More actions for ${friend.username}`}
                              aria-label={`More actions for ${friend.username}`}
                              disabled={openingDmPeerId === friend.id}
                              onClick={(e) => {
                                e.stopPropagation()
                                openSocialContextMenu(e, {
                                  kind: 'friend',
                                  userId: friend.id,
                                  username: friend.username,
                                  avatarUrl: friend.avatar_url,
                                  status: friend.status,
                                })
                              }}
                            >
                              <MoreHorizontal size={16} />
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {view === 'dm' && (
          <DmConversation
            {...{
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
            }}
          />
        )}
      </div>
    </>
  )
}
