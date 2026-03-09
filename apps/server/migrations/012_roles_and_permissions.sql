-- Granular roles and permissions
-- Server-scoped roles, member-role mapping, and channel role overrides.

-- Server roles: per-server named roles with a permissions bitmask.
CREATE TABLE server_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    color VARCHAR(16),
    position INTEGER NOT NULL DEFAULT 0,
    permissions BIGINT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_server_roles_server_name
    ON server_roles(server_id, LOWER(name));

-- Many-to-many: members can have multiple roles in a server.
CREATE TABLE server_member_roles (
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES server_roles(id) ON DELETE CASCADE,
    PRIMARY KEY (server_id, user_id, role_id)
);

CREATE INDEX idx_server_member_roles_user
    ON server_member_roles(user_id);

-- Channel-level role permission overrides (allow/deny like Discord).
CREATE TABLE channel_role_overrides (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES server_roles(id) ON DELETE CASCADE,
    allow BIGINT NOT NULL DEFAULT 0,
    deny BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, role_id)
);

