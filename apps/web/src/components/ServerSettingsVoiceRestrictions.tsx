import { useCallback, useEffect, useState } from 'react'
import { serverApi, type AuthToken, type ServerVoiceRestrictionEntry } from '../api'

function restrictionLabel(entry: ServerVoiceRestrictionEntry): string {
    if (entry.voice_server_muted && entry.voice_server_deafened) return 'Server muted and deafened'
    return entry.voice_server_muted ? 'Server muted' : 'Server deafened'
}

/**
 * Members whose server mute or deafen is stored on the membership. It stays after they leave
 * voice, so moderators can lift it here without waiting for them to rejoin. Hidden for users who
 * may not see it.
 */
export default function ServerSettingsVoiceRestrictions({ serverId, token }: { serverId: string | null; token: AuthToken }) {
    const [entries, setEntries] = useState<ServerVoiceRestrictionEntry[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [clearingUserId, setClearingUserId] = useState<string | null>(null)

    useEffect(() => {
        if (!serverId) return
        let cancelled = false
        serverApi.listVoiceRestrictions(serverId, token)
            .then((rows) => { if (!cancelled) setEntries(rows) })
            .catch(() => { if (!cancelled) setEntries(null) })
        return () => { cancelled = true }
    }, [serverId, token])

    const clear = useCallback(async (entry: ServerVoiceRestrictionEntry) => {
        if (!serverId) return
        setClearingUserId(entry.user_id)
        setError(null)
        try {
            await serverApi.clearMemberVoiceModeration(serverId, entry.user_id, {
                muted: entry.voice_server_muted,
                deafened: entry.voice_server_deafened,
            }, token)
            setEntries((current) => current?.filter((row) => row.user_id !== entry.user_id) ?? null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not remove the voice restriction.')
        } finally {
            setClearingUserId(null)
        }
    }, [serverId, token])

    if (!entries) return null

    return (
        <>
            <h3 className="server-settings-card__title" style={{ marginTop: 18 }}>Voice Restrictions</h3>
            {error && <div className="auth-error" role="alert">{error}</div>}
            {entries.length === 0 ? (
                <div className="server-settings-empty-state">No server-muted or deafened members.</div>
            ) : (
                <div className="server-report-list">
                    {entries.map((entry) => (
                        <div key={entry.user_id} className="server-report-row">
                            <div className="server-report-meta">
                                <div className="server-report-head">
                                    <strong>{entry.username}</strong>
                                    <span className="server-report-status is-open">{restrictionLabel(entry)}</span>
                                </div>
                            </div>
                            <div className="server-report-actions">
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    disabled={clearingUserId === entry.user_id}
                                    aria-label={`Remove voice restriction for ${entry.username}`}
                                    onClick={() => void clear(entry)}
                                >
                                    {clearingUserId === entry.user_id ? 'Removing...' : 'Remove'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </>
    )
}
