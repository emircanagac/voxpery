import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Volume2 } from 'lucide-react'
import { attachmentApi, dmApi, type DmChannel, type MessageWithAuthor } from '../api'
import ChatArea from '../components/ChatArea'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import { useToastStore } from '../stores/toast'
import { MAX_CHAT_ATTACHMENT_BYTES, getMaxChatAttachmentMb } from '../attachments'
import {
  applyUploadedDraftAttachments,
  createUploadingDraftAttachments,
  getUploadedDraftAttachments,
  hasPendingDraftAttachments,
  markDraftAttachmentsFailed,
  setDraftAttachmentUploading,
  type DraftAttachmentItem,
} from '../draftAttachments'

type UiDmMessage = MessageWithAuthor & {
  clientId?: string
  clientStatus?: 'sending' | 'failed'
  clientError?: string
}

function normalizePresence(status?: string | null): 'online' | 'dnd' | 'offline' {
  const normalized = (status ?? 'offline').toLowerCase()
  if (normalized === 'online' || normalized === 'dnd') return normalized
  return 'offline'
}

function presenceLabel(status?: string | null): string {
  const normalized = normalizePresence(status)
  if (normalized === 'dnd') return 'Do Not Disturb'
  if (normalized === 'offline') return 'Offline'
  return 'Online'
}

export default function DmPage() {
  const { userId } = useParams()
  const { token, user } = useAuthStore()
  const { subscribe, send, isConnected } = useSocketStore()
  const pushToast = useToastStore((state) => state.pushToast)
  const navigate = useNavigate()

  const [channels, setChannels] = useState<DmChannel[]>([])
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UiDmMessage[]>([])
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<DraftAttachmentItem[]>([])
  const [typingPeer, setTypingPeer] = useState<string | null>(null)
  const [peerLastReadMessageId, setPeerLastReadMessageId] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string; contentSnippet: string } | null>(null)
  const [deleteConfirmMessageId, setDeleteConfirmMessageId] = useState<string | null>(null)
  const typingTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    if (!user) return
    dmApi
      .listChannels(token)
      .then((list) => {
        setChannels(list)
        if (!activeChannelId && list.length > 0 && !userId) {
          setActiveChannelId(list[0].id)
        }
      })
      .catch(console.error)
  }, [activeChannelId, token, user, userId])

  useEffect(() => {
    if (!user || !userId) return
    dmApi
      .getOrCreateChannel(userId, token)
      .then((channel) => {
        setActiveChannelId(channel.id)
        setChannels((prev) => {
          if (prev.some((entry) => entry.id === channel.id)) return prev
          return [channel, ...prev]
        })
      })
      .catch(console.error)
  }, [token, user, userId])

  useEffect(() => {
    if (!user || !activeChannelId) return
    dmApi
      .listMessages(activeChannelId, token)
      .then((rows) =>
        setMessages(rows.map((message) => ({ ...message, clientStatus: undefined, clientId: undefined, clientError: undefined }))),
      )
      .catch(console.error)
  }, [activeChannelId, token, user])

  useEffect(() => {
    if (!user || !activeChannelId) return
    dmApi
      .readState(activeChannelId, token)
      .then((state) => setPeerLastReadMessageId(state.peer_last_read_message_id))
      .catch(console.error)
    const intervalId = window.setInterval(() => {
      dmApi
        .readState(activeChannelId, token)
        .then((state) => setPeerLastReadMessageId(state.peer_last_read_message_id))
        .catch(() => {})
    }, 3000)
    return () => window.clearInterval(intervalId)
  }, [activeChannelId, token, user])

  useEffect(() => {
    if (!activeChannelId || !isConnected) return
    send('Subscribe', { channel_ids: [activeChannelId] })
    return () => send('Unsubscribe', { channel_ids: [activeChannelId] })
  }, [activeChannelId, isConnected, send])

  useEffect(() => {
    const unsubscribe = subscribe((event: unknown) => {
      const payload = event as {
        type?: string
        data?: {
          channel_id?: string
          message?: unknown
          message_id?: string
          user_id?: string
          is_typing?: boolean
          username?: string
        }
      }
      if (!payload?.type) return
      if (payload.type === 'NewMessage') {
        const data = payload.data
        if (!data || data.channel_id !== activeChannelId) return
        const incoming = data.message as MessageWithAuthor
        setMessages((prev) => {
          const existingIndex = prev.findIndex((message) => message.id === incoming.id)
          if (existingIndex >= 0) {
            const next = [...prev]
            next[existingIndex] = incoming
            return next
          }
          const withoutOptimistic = prev.filter(
            (message) =>
              !(
                message.clientStatus === 'sending' &&
                message.author.user_id === incoming.author.user_id &&
                message.content === incoming.content
              ),
          )
          return [...withoutOptimistic, incoming]
        })
      }
      if (payload.type === 'MessageUpdated') {
        const data = payload.data
        if (!data || data.channel_id !== activeChannelId) return
        const updated = data.message as MessageWithAuthor
        setMessages((prev) => prev.map((message) => (message.id === updated.id ? updated : message)))
      }
      if (payload.type === 'MessageDeleted') {
        const data = payload.data
        if (!data || data.channel_id !== activeChannelId || !data.message_id) return
        setMessages((prev) => prev.filter((message) => message.id !== data.message_id))
      }
      if (payload.type === 'Typing') {
        const data = payload.data
        if (!data || data.channel_id !== activeChannelId) return
        if (data.user_id === user?.id) return
        setTypingPeer(data.is_typing ? (data.username ?? null) : null)
      }
    })
    return () => unsubscribe()
  }, [activeChannelId, subscribe, user?.id])

  useEffect(() => {
    const unsubscribe = subscribe((event: unknown) => {
      const payload = event as { type?: string; data?: { user_id?: string; status?: string } }
      if (payload?.type !== 'PresenceUpdate') return
      const { user_id, status } = payload.data ?? {}
      if (!user_id || status == null) return
      setChannels((prev) =>
        prev.some((channel) => channel.peer_id === user_id)
          ? prev.map((channel) => (channel.peer_id === user_id ? { ...channel, peer_status: status } : channel))
          : prev,
      )
    })
    return () => unsubscribe()
  }, [subscribe])

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    setTypingPeer(null)
    setReplyingTo(null)
    setEditingMessageId(null)
    setEditingContent('')
    setDeleteConfirmMessageId(null)
  }, [activeChannelId])

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  )

  const syntheticChannel = useMemo(
    () =>
      activeChannel
        ? {
            id: activeChannel.id,
            server_id: '',
            name: activeChannel.peer_username,
            channel_type: 'text' as const,
            position: 0,
          }
        : undefined,
    [activeChannel],
  )

  const typingIndicatorLabel = typingPeer ? `${typingPeer} is typing...` : null

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!user || !activeChannelId) return
    if (hasPendingDraftAttachments(attachments)) {
      pushToast({
        level: 'error',
        title: 'Attachment still pending',
        message: 'Finish uploading attachments or retry failed ones before sending.',
      })
      return
    }
    const pendingAttachments = getUploadedDraftAttachments(attachments)
    if (!input.trim() && pendingAttachments.length === 0) return
    const bodyText = input.trim()
    const content = replyingTo ? `> @${replyingTo.username}: ${replyingTo.contentSnippet}\n\n${bodyText}` : bodyText
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimisticId = `local-${clientId}`
    const optimisticMessage: UiDmMessage = {
      id: optimisticId,
      channel_id: activeChannelId,
      content,
      attachments: pendingAttachments,
      created_at: new Date().toISOString(),
      edited_at: null,
      author: {
        user_id: user.id,
        username: user.username,
        avatar_url: user.avatar_url,
      },
      clientId,
      clientStatus: 'sending',
    }

    setReplyingTo(null)
    setInput('')
    setAttachments([])
    setMessages((prev) => [...prev, optimisticMessage])

    try {
      const sent = await dmApi.sendMessage(activeChannelId, content, pendingAttachments, token)
      setMessages((prev) => {
        if (prev.some((message) => message.id === sent.id)) return prev
        const optimisticIndex = prev.findIndex((message) => message.clientId === clientId)
        if (optimisticIndex < 0) return [...prev, sent]
        const next = [...prev]
        next[optimisticIndex] = sent
        return next
      })
    } catch (error) {
      setMessages((prev) =>
        prev.map((message) =>
          message.clientId === clientId
            ? {
                ...message,
                clientStatus: 'failed',
                clientError: error instanceof Error ? error.message : 'Send failed',
              }
            : message,
        ),
      )
    }
  }

  const retryDraftAttachment = async (localId: string) => {
    const target = attachments.find((attachment) => attachment.localId === localId)
    if (!target?.file) return
    setAttachments((prev) => setDraftAttachmentUploading(prev, localId))
    try {
      const [uploaded] = await attachmentApi.uploadFiles([target.file], token)
      if (!uploaded) throw new Error('Could not upload attachment.')
      setAttachments((prev) => applyUploadedDraftAttachments(prev, [localId], [uploaded]))
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Could not upload attachment(s).'
      setAttachments((prev) => markDraftAttachmentsFailed(prev, [localId], errorMessage))
      pushToast({
        level: 'error',
        title: 'Upload failed',
        message: errorMessage,
      })
    }
  }

  const retryDmMessage = async (clientId: string) => {
    if (!user || !activeChannelId) return
    const target = messages.find((message) => message.clientId === clientId)
    if (!target || target.clientStatus !== 'failed') return
    setMessages((prev) =>
      prev.map((message) =>
        message.clientId === clientId ? { ...message, clientStatus: 'sending', clientError: undefined } : message,
      ),
    )
    try {
      const sent = await dmApi.sendMessage(activeChannelId, target.content, target.attachments ?? [], token)
      setMessages((prev) => {
        if (prev.some((message) => message.id === sent.id)) return prev.filter((message) => message.clientId !== clientId)
        return prev.map((message) => (message.clientId === clientId ? sent : message))
      })
    } catch (error) {
      setMessages((prev) =>
        prev.map((message) =>
          message.clientId === clientId
            ? {
                ...message,
                clientStatus: 'failed',
                clientError: error instanceof Error ? error.message : 'Retry failed',
              }
            : message,
        ),
      )
    }
  }

  const handleMessageInputChange = (value: string) => {
    setInput(value)
    if (!activeChannelId) return
    send('Typing', { channel_id: activeChannelId, is_typing: true })
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = window.setTimeout(() => {
      send('Typing', { channel_id: activeChannelId, is_typing: false })
      typingTimeoutRef.current = null
    }, 1200)
  }

  const handleAttachmentPick = async (files: FileList | null) => {
    if (!files) return
    const incoming = Array.from(files)
    const remainingSlots = Math.max(0, 4 - attachments.length)
    if (remainingSlots === 0) {
      pushToast({ level: 'error', title: 'Upload blocked', message: 'Maximum 4 attachments per message.' })
      return
    }
    const selected = incoming.slice(0, remainingSlots)
    if (incoming.length > remainingSlots) {
      pushToast({ level: 'error', title: 'Upload blocked', message: 'Maximum 4 attachments per message.' })
    }

    const allowed: File[] = []
    const oversized: string[] = []
    for (const file of selected) {
      if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
        oversized.push(file.name)
        continue
      }
      allowed.push(file)
    }
    if (oversized.length > 0) {
      const maxMb = getMaxChatAttachmentMb()
      pushToast({
        level: 'error',
        title: 'Upload blocked',
        message: `Maximum ${maxMb} MB per file. Too large: ${oversized.join(', ')}`,
      })
    }
    if (allowed.length === 0) return

    const pending = createUploadingDraftAttachments(allowed)
    const pendingIds = pending.map((attachment) => attachment.localId)
    setAttachments((prev) => [...prev, ...pending].slice(0, 4))

    try {
      const uploaded = await attachmentApi.uploadFiles(allowed, token)
      setAttachments((prev) => applyUploadedDraftAttachments(prev, pendingIds, uploaded))
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Could not upload attachment(s).'
      setAttachments((prev) => markDraftAttachmentsFailed(prev, pendingIds, errorMessage))
      pushToast({
        level: 'error',
        title: 'Upload failed',
        message: errorMessage,
      })
    }
  }

  const handleToggleReaction = useCallback(
    async (messageId: string, emoji: string, reacted: boolean) => {
      if (!user) return
      try {
        const updated = reacted
          ? await dmApi.removeReaction(messageId, emoji, token)
          : await dmApi.addReaction(messageId, emoji, token)
        setMessages((prev) => prev.map((message) => (message.id === updated.id ? updated : message)))
      } catch (error) {
        pushToast({
          level: 'error',
          title: 'Reaction failed',
          message: error instanceof Error ? error.message : 'Could not update reaction.',
        })
      }
    },
    [pushToast, token, user],
  )

  const handleSaveEdit = async () => {
    if (!user || !editingMessageId || !editingContent.trim()) return
    const updated = await dmApi.editMessage(editingMessageId, editingContent.trim(), token)
    setMessages((prev) => prev.map((message) => (message.id === updated.id ? updated : message)))
    setEditingMessageId(null)
    setEditingContent('')
  }

  const handleDeleteMessage = async (messageId: string) => {
    if (!user) return
    try {
      await dmApi.deleteMessage(messageId, token)
      setMessages((prev) => prev.filter((message) => message.id !== messageId))
      setDeleteConfirmMessageId(null)
    } catch (error) {
      pushToast({
        level: 'error',
        title: 'Delete failed',
        message: error instanceof Error ? error.message : 'Could not delete message',
      })
      setDeleteConfirmMessageId(null)
    }
  }

  return (
    <div className="dm-page">
      <aside className="dm-sidebar">
        <div className="dm-sidebar-title">Direct Messages</div>
        {channels.map((channel) => (
          <button
            key={channel.id}
            type="button"
            className={`dm-item ${activeChannelId === channel.id ? 'active' : ''}`}
            onClick={() => {
              setActiveChannelId(channel.id)
              navigate('/')
            }}
          >
            <div
              className={`dm-avatar avatar-status-${normalizePresence(channel.peer_status)}`}
            >
              {channel.peer_avatar_url ? <img src={channel.peer_avatar_url} alt="" /> : channel.peer_username.charAt(0).toUpperCase()}
            </div>
            <div className="dm-meta">
              <div>{channel.peer_username}</div>
              <span>
                <span className={`home-presence-pill home-presence-pill-${normalizePresence(channel.peer_status)}`}>
                  <span className="home-presence-pill-dot" aria-hidden />
                  {presenceLabel(channel.peer_status)}
                </span>
              </span>
            </div>
          </button>
        ))}
      </aside>

      <section className="dm-chat">
        <div className="dm-chat-header">
          <div className="dm-chat-title">{activeChannel ? activeChannel.peer_username : 'Select a DM'}</div>
          <button
            type="button"
            className="home-member-action"
            title="Voice action via friend flow"
            onClick={() => navigate('/')}
          >
            <Volume2 size={15} />
          </button>
        </div>

        <ChatArea
          activeChannel={syntheticChannel}
          messages={messages}
          draftAttachments={attachments}
          messageInput={input}
          onPickAttachments={handleAttachmentPick}
          onRemoveAttachment={(index) => setAttachments((prev) => prev.filter((_, currentIndex) => currentIndex !== index))}
          onRetryAttachment={retryDraftAttachment}
          onMessageInputChange={handleMessageInputChange}
          onSendMessage={handleSend}
          onRetryMessage={retryDmMessage}
          onDeleteMessage={setDeleteConfirmMessageId}
          onReplyToMessage={(message) => {
            const username = message.author?.username ?? 'User'
            const snippet = message.content.length > 80 ? `${message.content.slice(0, 80)}...` : message.content
            setReplyingTo({ id: message.id, username, contentSnippet: snippet })
          }}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          editingMessageId={editingMessageId}
          editingContent={editingContent}
          onEditMessage={(message) => {
            setEditingMessageId(message.id)
            setEditingContent(message.contentToEdit ?? message.content)
          }}
          onEditingContentChange={setEditingContent}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={() => {
            setEditingMessageId(null)
            setEditingContent('')
          }}
          currentUserId={user?.id ?? null}
          isDm
          isViewActive
          onToggleReaction={handleToggleReaction}
          typingIndicatorLabel={typingIndicatorLabel}
          seenMessageId={peerLastReadMessageId}
        />
      </section>

      {deleteConfirmMessageId &&
        createPortal(
          <div className="modal-overlay" onClick={() => setDeleteConfirmMessageId(null)}>
            <div className="modal confirm-modal" onClick={(event) => event.stopPropagation()}>
              <h2>Delete message</h2>
              <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                Are you sure you want to delete this message?
              </p>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setDeleteConfirmMessageId(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void handleDeleteMessage(deleteConfirmMessageId)}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
