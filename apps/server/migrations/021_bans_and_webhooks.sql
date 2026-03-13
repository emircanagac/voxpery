-- Server bans: prevents banned users from joining via invite.
CREATE TABLE IF NOT EXISTS server_bans (
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    banned_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (server_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_server_bans_server_id ON server_bans(server_id);
CREATE INDEX IF NOT EXISTS idx_server_bans_user_id ON server_bans(user_id);

-- Server webhooks: managed by MANAGE_WEBHOOKS permission.
CREATE TABLE IF NOT EXISTS server_webhooks (
    id UUID PRIMARY KEY,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    target_url TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_server_webhooks_server_id ON server_webhooks(server_id);
CREATE INDEX IF NOT EXISTS idx_server_webhooks_channel_id ON server_webhooks(channel_id);
