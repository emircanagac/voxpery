import type { ServerRole } from '../api'

type ServerRolesSidebarProps = {
    rolesLoading: boolean
    selectedRoleId: string | null
    serverRoles: ServerRole[]
    visibleServerRoles: ServerRole[]
    hasMoreServerRoles: boolean
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
    onRoleDragStart,
    onRoleDrop,
    onRoleSelect,
    onLoadMoreRoles,
}: ServerRolesSidebarProps) {
    return (
        <div className="server-roles-sidebar">
            <div className="server-roles-sidebar-header">
                <span className="server-roles-sidebar-header__eyebrow">Available roles</span>
                <strong className="server-roles-sidebar-header__title">{serverRoles.length} total</strong>
            </div>
            <div className="server-roles-sidebar-list">
                {rolesLoading && (
                    <div className="server-roles-sidebar-state">Loading roles…</div>
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
                    <div className="server-roles-sidebar-more">
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
                    <div className="server-roles-sidebar-state">
                        No roles yet. Create one to get started.
                    </div>
                )}
            </div>
        </div>
    )
}
