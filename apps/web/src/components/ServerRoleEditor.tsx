type PermissionBits = {
    manageServer: number
    manageRoles: number
    manageChannels: number
    viewAuditLog: number
    manageMessages: number
    managePins: number
    muteMembers: number
    deafenMembers: number
    kickMembers: number
    banMembers: number
}

type ServerRoleEditorProps = {
    selectedRoleId: string | null
    roleEditName: string
    roleEditColor: string | null
    roleEditPermissions: number
    bits: PermissionBits
    onRoleNameChange: (value: string) => void
    onRoleColorChange: (value: string | null) => void
    onTogglePermission: (bit: number, isFullAdmin: boolean, checked: boolean) => void
}

export default function ServerRoleEditor({
    selectedRoleId,
    roleEditName,
    roleEditColor,
    roleEditPermissions,
    bits,
    onRoleNameChange,
    onRoleColorChange,
    onTogglePermission,
}: ServerRoleEditorProps) {
    if (!selectedRoleId) {
        return (
            <div className="server-role-editor-empty">
                <span className="server-role-editor-empty__eyebrow">Role editor</span>
                <strong className="server-role-editor-empty__title">Choose or create a role</strong>
                <p className="server-role-editor-empty__hint">
                    Select a role from the list to edit its permissions, or create a new role to start building access rules.
                </p>
            </div>
        )
    }

    const groups = [
        {
            title: 'Server',
            perms: [
                { label: 'Full admin', bit: bits.manageServer },
                { label: 'Manage roles', bit: bits.manageRoles },
                { label: 'Manage channels', bit: bits.manageChannels },
                { label: 'View audit log', bit: bits.viewAuditLog },
            ],
        },
        {
            title: 'Messages',
            perms: [
                { label: 'Manage messages', bit: bits.manageMessages },
                { label: 'Manage pins', bit: bits.managePins },
            ],
        },
        {
            title: 'Voice',
            perms: [
                { label: 'Mute members', bit: bits.muteMembers },
                { label: 'Deafen members', bit: bits.deafenMembers },
            ],
        },
        {
            title: 'Moderation',
            perms: [
                { label: 'Kick members', bit: bits.kickMembers },
                { label: 'Ban members', bit: bits.banMembers },
            ],
        },
    ] as const

    return (
        <div className="server-role-editor">
            <div className="server-role-editor-meta">
                <div>
                    <label className="server-settings-card__title server-role-editor-label">
                        Role name
                    </label>
                    <input
                        type="text"
                        value={roleEditName}
                        onChange={(e) => onRoleNameChange(e.target.value)}
                        maxLength={64}
                        placeholder="Role name"
                        className="server-role-editor-name-input"
                    />
                </div>
                <div className="server-role-editor-color-wrap">
                    <label className="server-settings-card__title server-role-editor-label">
                        Role color
                    </label>
                    <div className="server-role-editor-color-row">
                        <input
                            type="color"
                            value={roleEditColor ?? '#ffffff'}
                            onChange={(e) => onRoleColorChange(e.target.value)}
                            className="server-role-editor-color-input"
                        />
                        <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            style={{ fontSize: 11, padding: '4px 10px' }}
                            onClick={() => onRoleColorChange(null)}
                        >
                            Clear color
                        </button>
                    </div>
                </div>
            </div>
            <div className="server-role-permissions-wrap">
                <div className="server-settings-card__title server-role-editor-label">
                    Permissions
                </div>
                <div className="server-role-permissions-groups">
                    {groups.map((group) => (
                        <section key={group.title} className="server-role-permission-group">
                            <div className="server-role-permission-group-title">{group.title}</div>
                            <div className="server-role-permission-group-items">
                                {group.perms.map((perm) => {
                                    const isFullAdmin = perm.bit === bits.manageServer
                                    const fullAdminOn = (roleEditPermissions & bits.manageServer) === bits.manageServer
                                    const isDisabled = !isFullAdmin && fullAdminOn
                                    return (
                                        <label
                                            key={perm.bit}
                                            className="server-role-permission-item"
                                            style={{ opacity: isDisabled ? 0.85 : 1 }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={
                                                    fullAdminOn && !isFullAdmin
                                                        ? true
                                                        : (roleEditPermissions & perm.bit) === perm.bit
                                                }
                                                disabled={isDisabled}
                                                onChange={(e) => onTogglePermission(perm.bit, isFullAdmin, e.target.checked)}
                                            />
                                            <span>{perm.label}</span>
                                        </label>
                                    )
                                })}
                            </div>
                        </section>
                    ))}
                </div>
            </div>
        </div>
    )
}
