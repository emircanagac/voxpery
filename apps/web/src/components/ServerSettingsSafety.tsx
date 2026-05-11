import { Ban, Flag, ShieldAlert } from 'lucide-react'
import ServerSettingsAutoMod from './ServerSettingsAutoMod'
import type { AuthToken, RaidEventEntry, ServerBanEntry, ServerReportEntry, ServerTimeoutEntry } from '../api'

export type SafetySettingsTab = 'reports' | 'automod' | 'bans'

type ReportReason = 'spam' | 'harassment' | 'inappropriate_content' | 'impersonation' | 'other'

const REPORT_REASONS: Array<{ value: ReportReason; label: string }> = [
    { value: 'spam', label: 'Spam' },
    { value: 'harassment', label: 'Harassment' },
    { value: 'inappropriate_content', label: 'Inappropriate content' },
    { value: 'impersonation', label: 'Impersonation' },
    { value: 'other', label: 'Other' },
]

type ServerSettingsSafetyProps = {
    activeTab: SafetySettingsTab
    onTabChange: (tab: SafetySettingsTab) => void
    serverId: string | null
    token: AuthToken
    canViewReports: boolean
    canManageAutoMod: boolean
    canManageBans: boolean
    reportEntries: ServerReportEntry[] | null
    reportEntriesLoading: boolean
    reportEntriesError: string | null
    resolveReportInFlightId: string | null
    timeoutEntries: ServerTimeoutEntry[] | null
    raidEventEntries: RaidEventEntry[] | null
    clearTimeoutInFlightUserId: string | null
    banEntries: ServerBanEntry[] | null
    banEntriesLoading: boolean
    banEntriesError: string | null
    unbanInFlightUserId: string | null
    onResolveReport: (reportId: string) => void
    onClearTimeout: (userId: string) => void
    onUnban: (userId: string) => void
}

export default function ServerSettingsSafety({
    activeTab,
    onTabChange,
    serverId,
    token,
    canViewReports,
    canManageAutoMod,
    canManageBans,
    reportEntries,
    reportEntriesLoading,
    reportEntriesError,
    resolveReportInFlightId,
    timeoutEntries,
    raidEventEntries,
    clearTimeoutInFlightUserId,
    banEntries,
    banEntriesLoading,
    banEntriesError,
    unbanInFlightUserId,
    onResolveReport,
    onClearTimeout,
    onUnban,
}: ServerSettingsSafetyProps) {
    return (
        <>
            <div className="server-settings-subnav" role="tablist" aria-label="Safety sections">
                {canViewReports && (
                    <button
                        type="button"
                        className={`server-settings-subnav__item ${activeTab === 'reports' ? 'server-settings-subnav__item--active' : ''}`}
                        onClick={() => onTabChange('reports')}
                    >
                        <Flag size={15} />
                        <span>Reports</span>
                    </button>
                )}
                {canManageAutoMod && (
                    <button
                        type="button"
                        className={`server-settings-subnav__item ${activeTab === 'automod' ? 'server-settings-subnav__item--active' : ''}`}
                        onClick={() => onTabChange('automod')}
                    >
                        <ShieldAlert size={15} />
                        <span>AutoMod</span>
                    </button>
                )}
                {canManageBans && (
                    <button
                        type="button"
                        className={`server-settings-subnav__item ${activeTab === 'bans' ? 'server-settings-subnav__item--active' : ''}`}
                        onClick={() => onTabChange('bans')}
                    >
                        <Ban size={15} />
                        <span>Bans</span>
                    </button>
                )}
            </div>

            {activeTab === 'reports' && canViewReports && (
                <section className="server-settings-card server-settings-card--audit server-settings-card--stack server-settings-safety-section">
                    <h3 className="server-settings-card__title">Reports</h3>
                    <div className="server-settings-panel-copy">
                        <p className="server-settings-note">
                            Review user and message reports submitted by the community, then resolve them once handled.
                        </p>
                    </div>
                    {reportEntriesError && (
                        <div className="auth-error" style={{ marginBottom: 12 }}>
                            {reportEntriesError}
                        </div>
                    )}
                    {reportEntriesLoading && (
                        <div className="server-settings-empty-state">
                            Loading reports...
                        </div>
                    )}
                    {!reportEntriesLoading && reportEntries && reportEntries.length === 0 && (
                        <div className="server-settings-empty-state">
                            No reports yet.
                        </div>
                    )}
                    {!reportEntriesLoading && reportEntries && reportEntries.length > 0 && (
                        <div className="server-report-list">
                            {reportEntries.map((entry) => (
                                <div key={entry.id} className="server-report-row">
                                    <div className="server-report-meta">
                                        <div className="server-report-head">
                                            <strong>
                                                {entry.message_id ? `Message report: ${entry.reported_username}` : `User report: ${entry.reported_username}`}
                                            </strong>
                                            <span className={`server-report-status ${entry.status === 'resolved' ? 'is-resolved' : 'is-open'}`}>
                                                {entry.status === 'resolved' ? 'Resolved' : 'Open'}
                                            </span>
                                        </div>
                                        <div className="server-report-subline">
                                            Reported by {entry.reporter_username} on {new Date(entry.created_at).toLocaleString()}
                                        </div>
                                        <div className="server-report-tags">
                                            <span className="server-report-tag server-report-tag--reason">
                                                {REPORT_REASONS.find((reason) => reason.value === entry.reason)?.label ?? entry.reason}
                                            </span>
                                            {entry.channel_name && (
                                                <span className="server-report-tag">
                                                    #{entry.channel_name}
                                                </span>
                                            )}
                                        </div>
                                        {entry.message_excerpt && (
                                            <div className="server-report-excerpt" title={entry.message_excerpt}>
                                                "{entry.message_excerpt}"
                                            </div>
                                        )}
                                        {entry.details && (
                                            <div className="server-report-excerpt server-report-excerpt--details" title={entry.details}>
                                                Note: {entry.details}
                                            </div>
                                        )}
                                        {entry.resolved_at && entry.resolved_by_username && (
                                            <div className="server-report-subline">
                                                Resolved by {entry.resolved_by_username} on {new Date(entry.resolved_at).toLocaleString()}
                                            </div>
                                        )}
                                    </div>
                                    {entry.status === 'open' && (
                                        <div className="server-report-actions">
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                disabled={resolveReportInFlightId === entry.id}
                                                onClick={() => onResolveReport(entry.id)}
                                            >
                                                {resolveReportInFlightId === entry.id ? 'Resolving...' : 'Resolve'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                    {!reportEntriesLoading && (
                        <>
                            <h3 className="server-settings-card__title" style={{ marginTop: 18 }}>Active Timeouts</h3>
                            {timeoutEntries && timeoutEntries.length === 0 && (
                                <div className="server-settings-empty-state">
                                    No active timeouts.
                                </div>
                            )}
                            {timeoutEntries && timeoutEntries.length > 0 && (
                                <div className="server-report-list">
                                    {timeoutEntries.map((entry) => (
                                        <div key={entry.user_id} className="server-report-row">
                                            <div className="server-report-meta">
                                                <div className="server-report-head">
                                                    <strong>{entry.username}</strong>
                                                    <span className="server-report-status is-open">Timed out</span>
                                                </div>
                                                <div className="server-report-subline">
                                                    Until {new Date(entry.timed_out_until).toLocaleString()}
                                                    {entry.timeout_by_username ? ` by ${entry.timeout_by_username}` : ''}
                                                </div>
                                                {entry.reason && (
                                                    <div className="server-report-excerpt server-report-excerpt--details" title={entry.reason}>
                                                        Reason: {entry.reason}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="server-report-actions">
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    disabled={clearTimeoutInFlightUserId === entry.user_id}
                                                    onClick={() => onClearTimeout(entry.user_id)}
                                                >
                                                    {clearTimeoutInFlightUserId === entry.user_id ? 'Clearing...' : 'Clear timeout'}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <h3 className="server-settings-card__title" style={{ marginTop: 18 }}>Raid Events</h3>
                            {raidEventEntries && raidEventEntries.length === 0 && (
                                <div className="server-settings-empty-state">
                                    No raid events yet.
                                </div>
                            )}
                            {raidEventEntries && raidEventEntries.length > 0 && (
                                <div className="server-report-list">
                                    {raidEventEntries.map((entry) => (
                                        <div key={entry.id} className="server-report-row">
                                            <div className="server-report-meta">
                                                <div className="server-report-head">
                                                    <strong>{entry.event_type.replaceAll('_', ' ')}</strong>
                                                    <span className="server-report-status is-open">Detected</span>
                                                </div>
                                                <div className="server-report-subline">
                                                    {new Date(entry.created_at).toLocaleString()}
                                                    {entry.username ? ` by ${entry.username}` : ''}
                                                    {entry.channel_name ? ` in #${entry.channel_name}` : ''}
                                                </div>
                                                {entry.metadata != null && (
                                                    <div className="server-report-excerpt server-report-excerpt--details">
                                                        {JSON.stringify(entry.metadata) ?? ''}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </section>
            )}

            {activeTab === 'automod' && serverId && canManageAutoMod && (
                <ServerSettingsAutoMod
                    serverId={serverId}
                    token={token}
                />
            )}

            {activeTab === 'bans' && canManageBans && (
                <section className="server-settings-card server-settings-card--audit server-settings-card--stack server-settings-safety-section">
                    <h3 className="server-settings-card__title">Banned Users</h3>
                    <div className="server-settings-panel-copy">
                        <p className="server-settings-note">
                            Review blocked members and restore access when a ban is no longer needed.
                        </p>
                    </div>
                    {banEntriesError && (
                        <div className="auth-error" style={{ marginBottom: 12 }}>
                            {banEntriesError}
                        </div>
                    )}
                    {banEntriesLoading && (
                        <div className="server-settings-empty-state">
                            Loading banned users...
                        </div>
                    )}
                    {!banEntriesLoading && banEntries && banEntries.length === 0 && (
                        <div className="server-settings-empty-state">
                            No banned users.
                        </div>
                    )}
                    {!banEntriesLoading && banEntries && banEntries.length > 0 && (
                        <div className="server-settings-ban-list">
                            {banEntries.map((entry) => (
                                <div key={entry.user_id} className="server-settings-ban-row">
                                    <div className="server-settings-ban-meta">
                                        <strong>{entry.username}</strong>
                                        <span>
                                            Banned by {entry.banned_by_username} on {new Date(entry.created_at).toLocaleString()}
                                        </span>
                                        {entry.reason && (
                                            <span className="server-settings-ban-reason">Reason: {entry.reason}</span>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        disabled={unbanInFlightUserId === entry.user_id}
                                        onClick={() => onUnban(entry.user_id)}
                                    >
                                        {unbanInFlightUserId === entry.user_id ? 'Unbanning...' : 'Unban'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}
        </>
    )
}
