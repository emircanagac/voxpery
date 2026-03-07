import { useEffect, useState, type ReactNode } from 'react'
import { useSocketStore } from '../stores/socket'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { Activity, UserPlus, Bell, Mic } from 'lucide-react'
import '../styles/ActivityLog.css'

interface LogEntry {
  id: string
  message: string
  icon: ReactNode
  timestamp: number
}

export function ActivityLog() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const socketSubscribe = useSocketStore((s) => s.subscribe)
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    const unsub = socketSubscribe((evt: unknown) => {
      const e = evt as { type?: string; data?: any }
      console.log('[ActivityLog] WS Event Received:', e)
      if (!e?.type) return

      let newLog: Omit<LogEntry, 'id' | 'timestamp'> | null = null

      if (e.type === 'PresenceUpdate') {
        const { user_id, status } = e.data ?? {}
        if (user_id !== user?.id && status === 'online') {
          const friends = useAppStore.getState().friends
          const friend = friends.find(f => f.id === user_id)
          if (friend) {
            newLog = {
              message: `${friend.username} is now online`,
              icon: <Activity size={12} className="log-icon-online" />
            }
          }
        }
      } else if (e.type === 'FriendUpdate') {
        const { user_id } = e.data ?? {}
        // friend updates are usually sent to us (the receiver)
        if (user_id === user?.id) {
            newLog = {
                message: `New friend activity`,
                icon: <UserPlus size={12} className="log-icon-friend" />
            }
        }
      } else if (e.type === 'VoiceStateUpdate') {
        const { user_id, channel_id, server_id } = e.data ?? {}
        if (user_id !== user?.id && channel_id && server_id) {
            // Check if WE are in that server
            const servers = useAppStore.getState().servers
            const isMutualServer = servers.some(s => s.id === server_id)
            
            if (isMutualServer) {
              const friends = useAppStore.getState().friends
              const friend = friends.find(f => f.id === user_id)
              
              if (friend && friend.username) {
                  newLog = {
                      message: `${friend.username} joined voice`,
                      icon: <Mic size={12} className="log-icon-online" />
                  }
              }
            }
        }
      } else if (e.type === 'NewMessage') {
        const { message, channel_type } = e.data ?? {}
        // Sadece özel DM mesajlarında ve kendimiz atmadıysak bildirim göster
        if (channel_type === 'dm' && message && message.author?.user_id !== user?.id) {
          newLog = {
            message: `New message from ${message.author?.username || 'someone'}`,
            icon: <Bell size={12} className="log-icon-message" />
          }
        }
      }

      if (newLog) {
        const entry: LogEntry = {
          ...newLog,
          id: Math.random().toString(36).substr(2, 9),
          timestamp: Date.now()
        }
        
        setLogs(prev => {
          const next = [...prev, entry]
          // Keep only last 2 logs to perfectly fit the 80px box constraint
          if (next.length > 2) return next.slice(next.length - 2)
          return next
        })
      }
    })

    return () => unsub()
  }, [socketSubscribe, user])

  // Cleanup old logs
  useEffect(() => {
    if (logs.length === 0) return
    const interval = setInterval(() => {
      const now = Date.now()
      setLogs(prev => prev.filter(log => now - log.timestamp < 5000)) // 5 seconds exact lifespan
    }, 1000)
    return () => clearInterval(interval)
  }, [logs])

  // Notice we removed the "if (logs.length === 0) return null" entirely
  // so the wrapper is *always* rendered, and acts as the persistent UI zone.

  return (
    <div className="activity-log-container">
      <div className="activity-log-header">
        <Activity size={12} className="activity-pulse-icon" />
        <span>Activity Log</span>
      </div>
      <div className="activity-log-list">
        {logs.map((log) => (
          <div key={log.id} className="activity-log-item">
            {log.icon}
            <span className="activity-log-text">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
