import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { Edit3, Paperclip, Reply, Save, Send, Share2, Trash2, Volume2, X, Smile } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Attachment } from '../types'
import { attachmentApi, dmApi, type DmChannel, type MessageWithAuthor } from '../api'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import { useToastStore } from '../stores/toast'
import { openExternalUrl } from '../openExternalUrl'
import EmojiPicker from '../components/EmojiPicker'

type AttachmentItem = { id?: string; name: string; url: string; size: number; type: string }
type UiDmMessage = MessageWithAuthor & {
  clientId?: string
  clientStatus?: 'sending' | 'failed'
  clientError?: string
}

export default function DmPage() {
  const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024
  const { userId } = useParams()
  const { token, user } = useAuthStore()
  const pushToast = useToastStore((s) => s.pushToast)
  const navigate = useNavigate()
  const { subscribe, send, isConnected } = useSocketStore()

  const [channels, setChannels] = useState<DmChannel[]>([])
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UiDmMessage[]>([])
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [typingPeer, setTypingPeer] = useState<string | null>(null)
  const [peerLastReadMessageId, setPeerLastReadMessageId] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string; contentSnippet: string } | null>(null)
  const [forwardPickerMessageId, setForwardPickerMessageId] = useState<string | null>(null)
  const [deleteConfirmMessageId, setDeleteConfirmMessageId] = useState<string | null>(null)
  const [clickedLink, setClickedLink] = useState<string | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null)
  const forwardPickerRef = useRef<HTMLDivElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement | null>(null)
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null)
  const [emojiPickerPosition, setEmojiPickerPosition] = useState<{ top: number; left: number } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const typingTimeoutRef = useRef<number | null>(null)
  const dmScrollRef = useRef<HTMLDivElement | null>(null)
  const shouldAutoScrollRef = useRef(true)

  useEffect(() => {
    if (!user) return
    dmApi.listChannels(token).then((list) => {
      setChannels(list)
      if (!activeChannelId && list.length > 0 && !userId) {
        setActiveChannelId(list[0].id)
      }
    }).catch(console.error)
  }, [activeChannelId, token, userId, user])

  useEffect(() => {
    if (!user || !userId) return
    dmApi.getOrCreateChannel(userId, token).then((channel) => {
      setActiveChannelId(channel.id)
      setChannels((prev) => {
        const exists = prev.some((c) => c.id === channel.id)
        if (exists) return prev
        return [channel, ...prev]
      })
    }).catch(console.error)
  }, [token, userId, user])

  useEffect(() => {
    if (!user || !activeChannelId) return
    dmApi.listMessages(activeChannelId, token)
      .then((rows) => setMessages(rows.map((m) => ({ ...m, clientStatus: undefined, clientId: undefined, clientError: undefined }))))
      .catch(console.error)
  }, [activeChannelId, token, user])

  useEffect(() => {
    if (!user || !activeChannelId) return
    dmApi.readState(activeChannelId, token)
      .then((state) => setPeerLastReadMessageId(state.peer_last_read_message_id))
      .catch(console.error)
    const id = window.setInterval(() => {
      dmApi.readState(activeChannelId, token)
        .then((state) => setPeerLastReadMessageId(state.peer_last_read_message_id))
        .catch(() => { })
    }, 3000)
    return () => window.clearInterval(id)
  }, [activeChannelId, token, user])

  useEffect(() => {
    if (!activeChannelId || !isConnected) return
    send('Subscribe', { channel_ids: [activeChannelId] })
    return () => send('Unsubscribe', { channel_ids: [activeChannelId] })
  }, [activeChannelId, isConnected, send])

  useEffect(() => {
    const unsub = subscribe((evt: unknown) => {
      const e = evt as {
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
      if (e?.type === 'NewMessage') {
        const payload = e.data
        if (!payload || payload.channel_id !== activeChannelId) return
        const incoming = payload.message as MessageWithAuthor
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === incoming.id)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = incoming
            return next
          }
          const withoutMatchingOptimistic = prev.filter((m) => !(
            m.clientStatus === 'sending' &&
            m.author.user_id === incoming.author.user_id &&
            m.content === incoming.content
          ))
          return [...withoutMatchingOptimistic, incoming]
        })
      }
      if (e?.type === 'MessageUpdated') {
        const payload = e.data
        if (!payload || payload.channel_id !== activeChannelId) return
        const updated = payload.message as MessageWithAuthor
        setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
      }
      if (e?.type === 'MessageDeleted') {
        const payload = e.data
        if (!payload || payload.channel_id !== activeChannelId || !payload.message_id) return
        setMessages((prev) => prev.filter((m) => m.id !== payload.message_id))
      }
      if (e?.type === 'Typing') {
        const payload = e.data
        if (!payload || payload.channel_id !== activeChannelId) return
        if (payload.user_id === user?.id) return
        setTypingPeer(payload.is_typing ? (payload.username ?? null) : null)
      }
    })
    return () => unsub()
  }, [activeChannelId, subscribe, user?.id])

  // Keep DM channel peer status in sync with PresenceUpdate (online/offline)
  useEffect(() => {
    const unsub = subscribe((evt: unknown) => {
      const e = evt as { type?: string; data?: { user_id?: string; status?: string } }
      if (e?.type !== 'PresenceUpdate') return
      const { user_id, status } = e.data ?? {}
      if (!user_id || status == null) return
      setChannels((prev) =>
        prev.some((c) => c.peer_id === user_id)
          ? prev.map((c) => (c.peer_id === user_id ? { ...c, peer_status: status } : c))
          : prev
      )
    })
    return () => unsub()
  }, [subscribe])

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  )

  const virtualCount = messages.length + (typingPeer ? 1 : 0)
  const rowVirtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => dmScrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
  })

  useEffect(() => {
    if (virtualCount === 0) return
    if (!shouldAutoScrollRef.current) return
    rowVirtualizer.scrollToIndex(virtualCount - 1, { align: 'end' })
  }, [rowVirtualizer, virtualCount])

  const handleSend = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!user || !activeChannelId || (!input.trim() && attachments.length === 0)) return
    const bodyText = input.trim()
    const content = replyingTo
      ? `> @${replyingTo.username}: ${replyingTo.contentSnippet}\n\n${bodyText}`
      : bodyText
    setReplyingTo(null)
    const sendAttachments = attachments
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimisticId = `local-${clientId}`
    const optimistic: UiDmMessage = {
      id: optimisticId,
      channel_id: activeChannelId,
      content,
      attachments: sendAttachments,
      created_at: new Date().toISOString(),
      edited_at: null,
      author: {
        user_id: user?.id ?? 'local',
        username: user?.username ?? 'You',
        avatar_url: user?.avatar_url,
      },
      clientId,
      clientStatus: 'sending',
    }
    setInput('')
    setAttachments([])
    setMessages((prev) => [...prev, optimistic])
    try {
      const msg = await dmApi.sendMessage(activeChannelId, content, sendAttachments, token)
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev
        const idx = prev.findIndex((m) => m.clientId === clientId)
        if (idx < 0) return [...prev, msg]
        const next = [...prev]
        next[idx] = msg
        return next
      })
    } catch (err) {
      setMessages((prev) => prev.map((m) =>
        m.clientId === clientId
          ? { ...m, clientStatus: 'failed', clientError: err instanceof Error ? err.message : 'Send failed' }
          : m
      ))
    }
  }

  const retryDmMessage = async (clientId: string) => {
    if (!user || !activeChannelId) return
    const target = messages.find((m) => m.clientId === clientId)
    if (!target || target.clientStatus !== 'failed') return
    setMessages((prev) => prev.map((m) => (
      m.clientId === clientId ? { ...m, clientStatus: 'sending', clientError: undefined } : m
    )))
    try {
      const sent = await dmApi.sendMessage(activeChannelId, target.content, target.attachments ?? [], token)
      setMessages((prev) => {
        if (prev.some((m) => m.id === sent.id)) return prev.filter((m) => m.clientId !== clientId)
        return prev.map((m) => (m.clientId === clientId ? sent : m))
      })
    } catch (err) {
      setMessages((prev) => prev.map((m) =>
        m.clientId === clientId
          ? { ...m, clientStatus: 'failed', clientError: err instanceof Error ? err.message : 'Retry failed' }
          : m
      ))
    }
  }

  const onTypingInput = (value: string) => {
    setInput(value)
    if (!activeChannelId) return
    send('Typing', { channel_id: activeChannelId, is_typing: true })
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = window.setTimeout(() => {
      send('Typing', { channel_id: activeChannelId, is_typing: false })
      typingTimeoutRef.current = null
    }, 1200)
  }

  const insertEmoji = (emoji: string) => {
    const inputEl = inputRef.current
    const start = inputEl?.selectionStart ?? input.length
    const end = inputEl?.selectionEnd ?? start
    const next = `${input.slice(0, start)}${emoji}${input.slice(end)}`
    onTypingInput(next)
    setEmojiOpen(false)
    requestAnimationFrame(() => {
      const pos = start + emoji.length
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(pos, pos)
    })
  }

  const toggleDmReaction = async (messageId: string, emoji: string, reacted: boolean) => {
    if (!user) return
    try {
      const updated = reacted
        ? await dmApi.removeReaction(messageId, emoji, token)
        : await dmApi.addReaction(messageId, emoji, token)
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
    } catch (err) {
      pushToast({
        level: 'error',
        title: 'Reaction failed',
        message: err instanceof Error ? err.message : 'Could not update reaction.',
      })
    }
  }

  const handleAttachmentPick = async (files: FileList | null) => {
    if (!files) return
    const incoming = Array.from(files)
    const remainingSlots = Math.max(0, 4 - attachments.length)
    if (remainingSlots === 0) {
      pushToast({
        level: 'error',
        title: 'Upload blocked',
        message: 'Maximum 4 attachments per message.',
      })
      return
    }
    const list = incoming.slice(0, remainingSlots)
    if (incoming.length > remainingSlots) {
      pushToast({
        level: 'error',
        title: 'Upload blocked',
        message: 'Maximum 4 attachments per message.',
      })
    }
    const allowed: File[] = []
    const oversized: string[] = []
    for (const f of list) {
      if (f.size > MAX_ATTACHMENT_BYTES) {
        oversized.push(f.name)
        continue
      }
      allowed.push(f)
    }
    if (oversized.length > 0) {
      const maxMb = Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))
      pushToast({
        level: 'error',
        title: 'Upload blocked',
        message: `Maximum ${maxMb} MB per file. Too large: ${oversized.join(', ')}`,
      })
    }
    if (allowed.length === 0) return
    try {
      const uploaded = await attachmentApi.uploadFiles(allowed, token)
      const normalized: AttachmentItem[] = uploaded.map((att) => ({
        id: att.id,
        name: att.name || 'attachment',
        url: att.url,
        size: typeof att.size === 'number' ? att.size : 0,
        type: att.type || 'application/octet-stream',
      }))
      setAttachments((prev) => [...prev, ...normalized].slice(0, 4))
    } catch (err) {
      pushToast({
        level: 'error',
        title: 'Upload failed',
        message: err instanceof Error ? err.message : 'Could not upload attachment(s).',
      })
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const dt = e.clipboardData
    if (!dt) return
    const files: File[] = []
    if (dt.files) {
      for (let i = 0; i < dt.files.length; i++) files.push(dt.files[i])
    }
    if (files.length === 0 && dt.items) {
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i]
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
    }
    if (files.length === 0) return
    e.preventDefault()
    const dataTransfer = new DataTransfer()
    files.forEach((f) => dataTransfer.items.add(f))
    handleAttachmentPick(dataTransfer.files)
  }

  const startEdit = (msg: MessageWithAuthor) => {
    setEditingMessageId(msg.id)
    setEditingContent(msg.content)
  }

  const saveEdit = async () => {
    if (!user || !editingMessageId || !editingContent.trim()) return
    const updated = await dmApi.editMessage(editingMessageId, editingContent.trim(), token)
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
    setEditingMessageId(null)
    setEditingContent('')
  }

  const removeMessage = async (messageId: string) => {
    if (!user) return
    try {
      await dmApi.deleteMessage(messageId, token)
      setMessages((prev) => prev.filter((m) => m.id !== messageId))
      setDeleteConfirmMessageId(null)
    } catch (err) {
      pushToast({
        level: 'error',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : 'Could not delete message',
      })
      setDeleteConfirmMessageId(null)
    }
  }

  useEffect(() => {
    if (!forwardPickerMessageId) return
    const close = (e: MouseEvent) => {
      if (forwardPickerRef.current?.contains(e.target as Node)) return
      setForwardPickerMessageId(null)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [forwardPickerMessageId])

  useEffect(() => {
    if (!emojiOpen) return
    const syncPosition = () => {
      const button = emojiButtonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      const pickerWidth = 232
      const viewportPadding = 16
      const left = Math.max(
        viewportPadding,
        Math.min(rect.right - pickerWidth, window.innerWidth - pickerWidth - viewportPadding),
      )
      const top = Math.max(viewportPadding, rect.top - 12)
      setEmojiPickerPosition({ top, left })
    }
    const close = (e: MouseEvent) => {
      if (emojiPickerRef.current?.contains(e.target as Node)) return
      if (emojiButtonRef.current?.contains(e.target as Node)) return
      setEmojiOpen(false)
    }
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setEmojiOpen(false)
    }
    syncPosition()
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', syncPosition)
    window.addEventListener('scroll', syncPosition, true)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', syncPosition)
      window.removeEventListener('scroll', syncPosition, true)
    }
  }, [emojiOpen])

  useEffect(() => {
    if (!reactionPickerMessageId) return
    const close = () => setReactionPickerMessageId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [reactionPickerMessageId])

  const otherDmChannels = channels.filter((c) => c.id !== activeChannelId)

  useEffect(() => {
    setEmojiOpen(false)
    setReactionPickerMessageId(null)
  }, [activeChannelId])

  const handleForwardDm = async (msg: { author?: { username?: string }; content: string }, targetChannelId: string) => {
    if (!user) return
    const from = msg.author?.username ?? 'Someone'
    const content = `[Forwarded from @${from}]: ${msg.content}`
    const targetChannel = channels.find((c) => c.id === targetChannelId)
    setForwardPickerMessageId(null)
    if (targetChannelId !== activeChannelId && targetChannel) {
      setActiveChannelId(targetChannelId)
      navigate('/')
    }
    try {
      const sent = await dmApi.sendMessage(targetChannelId, content, [], token)
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]))
    } catch {
      // could toast
    }
  }

  const isSeen = (msgId: string) => {
    if (!peerLastReadMessageId) return false
    const idx = messages.findIndex((m) => m.id === msgId)
    const seenIdx = messages.findIndex((m) => m.id === peerLastReadMessageId)
    return idx >= 0 && seenIdx >= 0 && idx <= seenIdx
  }

  const formatDayDivider = (dateStr: string) => {
    const d = new Date(dateStr)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === today.toDateString()) return 'Today'
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
  }

  const isNewMessageDay = (index: number) => {
    if (index <= 0) return true
    const current = messages[index]
    const previous = messages[index - 1]
    if (!current?.created_at || !previous?.created_at) return false
    return new Date(current.created_at).toDateString() !== new Date(previous.created_at).toDateString()
  }

  const renderMessageWithMentions = (content: string) => {
    const parts = content.split(/(@[^\s@]{2,32}|@all|@everyone|https?:\/\/[^\s]+)/g)
    return parts.map((part, idx) => {
      if (!part) return null
      if (part === '@all') {
        return <span key={idx} className="mention-pill mention-pill-all">{part}</span>
      }
      if (part === '@everyone') {
        return <span key={idx}>{part}</span>
      }
      if (part.startsWith('http://') || part.startsWith('https://')) {
        return (
          <a
            key={idx}
            href="#"
            className="chat-link"
            onClick={(e) => {
              e.preventDefault()
              setClickedLink(part)
            }}
          >
            {part}
          </a>
        )
      }
      if (part.startsWith('@')) {
        const username = part.slice(1).toLowerCase()
        const isPeer = activeChannel && activeChannel.peer_username.toLowerCase() === username
        const isSelf = user && user.username.toLowerCase() === username
        if (isPeer || isSelf) {
          return <span key={idx} className="mention-pill">{part}</span>
        }
        return <span key={idx}>{part}</span>
      }
      return <span key={idx}>{part}</span>
    })
  }

  const parseForwardedContent = (content: string): { forwardFrom: string; body: string } | null => {
    const match = content.match(/^\[Forwarded from @([^\]]+)\]:\s*([\s\S]*)$/)
    if (!match) return null
    return { forwardFrom: match[1].trim(), body: match[2] }
  }

  const parseReplyContent = (content: string): { replyUsername: string; replyQuote: string; replyBody: string } | null => {
    if (!content.startsWith('> @')) return null
    const doubleNewline = content.indexOf('\n\n')
    if (doubleNewline < 0) return null
    const quotePart = content.slice(0, doubleNewline).trim()
    const replyBody = content.slice(doubleNewline + 2).trim()
    const match = quotePart.match(/^>\s*@([^:]+):\s*(.*)$/s)
    if (!match) return null
    return { replyUsername: match[1].trim(), replyQuote: match[2].trim(), replyBody }
  }

  const renderMessageContent = (content: string) => {
    const forwarded = parseForwardedContent(content)
    if (forwarded) {
      return (
        <div className="message-forwarded-block">
          <div className="message-forwarded-quote">
            <span className="message-forwarded-label">Forwarded from @{forwarded.forwardFrom}</span>
            {forwarded.body ? <div className="message-forwarded-body">{renderMessageWithMentions(forwarded.body)}</div> : null}
          </div>
        </div>
      )
    }
    const parsed = parseReplyContent(content)
    if (parsed) {
      return (
        <div className="message-reply-block">
          <div className="message-reply-quote">
            <span className="message-reply-quote-label">Reply to @{parsed.replyUsername}</span>
            <span className="message-reply-quote-text">{parsed.replyQuote}</span>
          </div>
          {parsed.replyBody ? <div className="message-reply-body">{renderMessageWithMentions(parsed.replyBody)}</div> : null}
        </div>
      )
    }
    return <div className="message-text">{renderMessageWithMentions(content)}</div>
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
            <div className={`dm-avatar avatar-status-${['online', 'dnd', 'offline'].includes((channel.peer_status ?? '').toLowerCase()) ? (channel.peer_status ?? 'offline').toLowerCase() : 'offline'}`}>
              {channel.peer_avatar_url ? (
                <img src={channel.peer_avatar_url} alt="" />
              ) : (
                channel.peer_username.charAt(0).toUpperCase()
              )}
            </div>
            <div className="dm-meta">
              <div>{channel.peer_username}</div>
              <span>{channel.peer_status}</span>
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
        <div
          className="dm-messages dm-messages-virtual"
          ref={dmScrollRef}
          onScroll={() => {
            const el = dmScrollRef.current
            if (!el) return
            const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
            shouldAutoScrollRef.current = distanceToBottom < 120
          }}
        >
          <div
            className="virtual-list-spacer"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const isTypingRow = typingPeer && virtualRow.index === messages.length
              if (isTypingRow) {
                return (
                  <div
                    key="typing-row"
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    className="virtual-list-item"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <div className="typing-indicator">{typingPeer} is typing...</div>
                  </div>
                )
              }

              const msg = messages[virtualRow.index]
              return (
                <div
                  key={msg.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className="virtual-list-item"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {isNewMessageDay(virtualRow.index) && (
                    <div className="message-day-divider" aria-label={`Messages from ${formatDayDivider(msg.created_at)}`}>
                      <span>{formatDayDivider(msg.created_at)}</span>
                    </div>
                  )}
                  <div className="message">
                    <div className="message-avatar">
                      {(() => {
                        const a = msg.author as { avatar_url?: string | null; avatarUrl?: string | null } | undefined
                        const url = (a?.avatar_url ?? a?.avatarUrl ?? '').toString().trim()
                        return url ? <img src={url} alt="" /> : (msg.author?.username ?? '?').charAt(0).toUpperCase()
                      })()}
                    </div>
                    <div className="message-content">
                      <div className="message-header">
                        <span className="message-author">{msg.author.username}</span>
                        <span className="message-timestamp">
                          {new Date(msg.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {msg.edited_at ? <span className="message-edited" title="Edited">(edited)</span> : null}
                        {!msg.clientStatus && (
                          <div className="message-inline-actions dm-message-actions" ref={forwardPickerMessageId === msg.id ? forwardPickerRef : undefined}>
                            <button
                              type="button"
                              className="message-inline-action-btn dm-msg-btn"
                              title="Add reaction"
                              aria-label="Add reaction"
                              onClick={(e) => {
                                e.stopPropagation()
                                setReactionPickerMessageId((prev) => (prev === msg.id ? null : msg.id))
                              }}
                            >
                              <Smile size={14} />
                            </button>
                            <button type="button" className="message-inline-action-btn dm-msg-btn" title="Reply" aria-label="Reply" onClick={(e) => {
                              e.stopPropagation()
                              const username = msg.author?.username ?? 'User'
                              const snippet = msg.content.length > 80 ? msg.content.slice(0, 80) + '...' : msg.content
                              setReplyingTo({ id: msg.id, username, contentSnippet: snippet })
                            }}>
                              <Reply size={14} />
                            </button>
                            {otherDmChannels.length > 0 && (
                              <>
                                <button type="button" className="message-inline-action-btn dm-msg-btn" title="Forward" aria-label="Forward" onClick={(e) => { e.stopPropagation(); setForwardPickerMessageId(forwardPickerMessageId === msg.id ? null : msg.id) }}>
                                  <Share2 size={14} />
                                </button>
                                {forwardPickerMessageId === msg.id && (
                                  <div className="message-menu-dropdown message-forward-dropdown">
                                    <div className="message-forward-dropdown-title">Forward: choose recipient</div>
                                    {otherDmChannels.map((ch) => (
                                      <button key={ch.id} type="button" className="message-menu-item" onClick={() => handleForwardDm(msg, ch.id)}>
                                        {ch.peer_username}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                            {msg.author.user_id === user?.id && (
                              <>
                                <button type="button" className="message-inline-action-btn dm-msg-btn" title="Edit" aria-label="Edit" onClick={(e) => { e.stopPropagation(); startEdit(msg) }}>
                                  <Edit3 size={14} />
                                </button>
                                <button type="button" className="message-inline-action-btn dm-msg-btn danger" title="Delete" aria-label="Delete" onClick={(e) => { e.stopPropagation(); setDeleteConfirmMessageId(msg.id) }}>
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        {reactionPickerMessageId === msg.id && (
                          <div
                            className="message-reaction-picker"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <EmojiPicker
                              compact
                              reactionMode
                              onSelect={(emoji) => {
                                void toggleDmReaction(msg.id, emoji, false)
                                setReactionPickerMessageId(null)
                              }}
                            />
                          </div>
                        )}
                      </div>
                      {editingMessageId === msg.id ? (
                        <div className="dm-edit-row">
                          <input
                            className="home-search"
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                          />
                          <button type="button" className="dm-msg-btn" onClick={saveEdit}>
                            <Save size={12} />
                          </button>
                          <button type="button" className="dm-msg-btn" onClick={() => setEditingMessageId(null)}>
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        renderMessageContent(msg.content)
                      )}
                      {Array.isArray(msg.reactions) && msg.reactions.length > 0 && (
                        <div className="message-reactions">
                          {msg.reactions.map((reaction) => (
                            <button
                              key={`${msg.id}-${reaction.emoji}`}
                              type="button"
                              className={`message-reaction-btn ${reaction.reacted ? 'is-reacted' : ''}`}
                              onClick={() => void toggleDmReaction(msg.id, reaction.emoji, !!reaction.reacted)}
                            >
                              <span>{reaction.emoji}</span>
                              <span>{reaction.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {msg.clientStatus === 'failed' && (
                        <div className="message-retry-row">
                          {msg.clientId && (
                            <button
                              type="button"
                              className="message-retry-btn"
                              onClick={() => {
                                if (!msg.clientId) return
                                retryDmMessage(msg.clientId)
                              }}
                            >
                              Retry
                            </button>
                          )}
                          <span className="message-send-state is-failed">Failed</span>
                          {msg.clientError && (
                            <span className="message-retry-error">{msg.clientError}</span>
                          )}
                        </div>
                      )}
                      {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                        <div className="dm-attachments">
                          {msg.attachments.map((att: Attachment, i: number) => (
                            <a key={i} href={att.url} target="_blank" rel="noreferrer" className="dm-attachment-link">
                              {att.name || `Attachment ${i + 1}`}
                            </a>
                          ))}
                        </div>
                      )}
                      {msg.author.user_id === user?.id && isSeen(msg.id) && (
                        <div className="dm-seen">Seen</div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <form className="message-input-container" onSubmit={handleSend}>
          {replyingTo && (
            <div className="message-reply-bar">
              <span className="message-reply-bar-label">Replying to @{replyingTo.username}</span>
              <span className="message-reply-bar-snippet">{replyingTo.contentSnippet}</span>
              <button type="button" className="message-reply-bar-cancel" onClick={() => setReplyingTo(null)} aria-label="Cancel reply">
                <X size={14} />
              </button>
            </div>
          )}
          <div className="message-input-wrapper">
            <label className="dm-attach-btn" title="Attach files">
              <Paperclip size={16} />
              <input
                type="file"
                multiple
                accept="*/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  handleAttachmentPick(e.target.files)
                  e.currentTarget.value = ''
                }}
              />
            </label>
            <button
              ref={emojiButtonRef}
              type="button"
              className="chat-emoji-btn"
              title="Insert emoji"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setEmojiOpen((prev) => !prev)
              }}
            >
              <Smile size={16} />
            </button>
            {emojiOpen && emojiPickerPosition && createPortal(
              <div
                ref={emojiPickerRef}
                className="chat-emoji-picker-shell chat-emoji-picker-portal"
                style={{
                  top: emojiPickerPosition.top,
                  left: emojiPickerPosition.left,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <EmojiPicker onSelect={insertEmoji} />
              </div>,
              document.body
            )}
            <textarea
              ref={inputRef}
              className="message-input"
              value={input}
              onChange={(e) => onTypingInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              onPaste={handlePaste}
              placeholder={activeChannel ? `Message @${activeChannel.peer_username}` : 'Select a DM channel'}
              rows={1}
            />
            <Send
              size={18}
              style={{ color: (input.trim() || attachments.length > 0) ? 'var(--accent-primary)' : 'var(--text-muted)', cursor: 'pointer' }}
              onClick={() => handleSend()}
            />
          </div>
          {attachments.length > 0 && (
            <div className="dm-draft-attachments">
              {attachments.map((att, i) => (
                <div key={`${att.name}-${i}`} className="dm-draft-attachment">
                  <span>{att.name}</span>
                  <button
                    type="button"
                    className="dm-msg-btn"
                    onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </form>
      </section>

      {deleteConfirmMessageId &&
        createPortal(
          <div className="modal-overlay" onClick={() => setDeleteConfirmMessageId(null)}>
            <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
              <h2>Delete message</h2>
              <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                Are you sure you want to delete this message?
              </p>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setDeleteConfirmMessageId(null)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-danger" onClick={() => void removeMessage(deleteConfirmMessageId)}>
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {clickedLink &&
        createPortal(
          <div className="modal-overlay" onClick={() => setClickedLink(null)}>
            <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
              <h2>External Link Warning</h2>
              <p style={{ marginTop: '0.5rem', marginBottom: '1.5rem', wordBreak: 'break-all' }}>
                You are about to leave Voxpery. Are you sure you want to visit:<br /><br />
                <strong>{clickedLink}</strong>
              </p>
              <div className="modal-actions" style={{ marginTop: 'auto' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setClickedLink(null)}>Cancel</button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    void openExternalUrl(clickedLink)
                    setClickedLink(null)
                  }}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

