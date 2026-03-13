import type { ServerRole } from '../api'

type ServerRolesSidebarProps = {
    rolesLoading: boolean
    selectedRoleId: string | null
    serverRoles: ServerRole[]
    visibleServerRoles: ServerRole[]
    hasMoreServerRoles: boolean
    onCreateRole: () => void
    onRoleDragStart: (roleId: string) => void
    onRoleDrop: (targetRoleId: string) => Promise<void>
    onRoleSelect: (role: ServerRole) => void
    onLoadMoreRoles: () => void
}

export default function ServerRolesSidebar({
    rolesLoading,
    selectedRoleId,
    serverRoles,
    visibleServerRoles,
    hasMoreServerRoles,
    onCreateRole,
    onRoleDragStart,
    onRoleDrop,
    onRoleSelect,
    onLoadMoreRoles,
}: ServerRolesSidebarProps) {
    return (
        <div className="server-roles-sidebar">
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                }}
            >
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Server roles
                </span>
                <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    style={{
                        fontSize: 11,
                        padding: '3px 10px',
                        borderRadius: 9999,
                        border: '1px solid rgba(255, 255, 255, 0.14)',
                        backgroundColor: 'rgba(255, 255, 255, 0.04)',
                        cursor: 'pointer',
                    }}
                    disabled={rolesLoading}
                    onClick={onCreateRole}
                >
                    Create role
                </button>
            </div>
            <div className="server-roles-sidebar-list">
                {rolesLoading && (
                    <div
                        style={{
                            padding: 8,
                            fontSize: 12,
                            color: 'var(--text-muted)',
                        }}
                    >
                        Loading roles…
                    </div>
                )}
                {!rolesLoading &&
                    visibleServerRoles.map((role) => (
                        <button
                            key={role.id}
                            type="button"
                            className={`server-role-list-item ${
                                selectedRoleId === role.id
                                    ? 'server-role-list-item--active'
                                    : ''
                            }`}
                            style={{
                                width: '100%',
                                textAlign: 'left',
                                cursor: 'grab',
                            }}
                            draggable
                            onDragStart={() => onRoleDragStart(role.id)}
                            onDragOver={(e) => {
                                e.preventDefault()
                            }}
                            onDrop={async (e) => {
                                e.preventDefault()
                                await onRoleDrop(role.id)
                            }}
                            onClick={() => onRoleSelect(role)}
                        >
                            {role.name}
                        </button>
                    ))}
                {!rolesLoading && hasMoreServerRoles && (
                    <div style={{ paddingTop: 8, display: 'flex', justifyContent: 'center' }}>
                        <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={onLoadMoreRoles}
                        >
                            Load more roles
                        </button>
                    </div>
                )}
                {!rolesLoading && serverRoles.length === 0 && (
                    <div
                        style={{
                            padding: 8,
                            fontSize: 12,
                            color: 'var(--text-muted)',
                        }}
                    >
                        No roles yet. Create one to get started.
                    </div>
                )}
            </div>
        </div>
    )
}
