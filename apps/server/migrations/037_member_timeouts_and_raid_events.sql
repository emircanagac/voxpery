CREATE TABLE IF NOT EXISTS server_member_timeouts (
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    timed_out_until TIMESTAMPTZ NOT NULL,
    timeout_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (server_id, user_id),
    CONSTRAINT server_member_timeouts_reason_length CHECK (reason IS NULL OR LENGTH(reason) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_server_member_timeouts_active
    ON server_member_timeouts(server_id, timed_out_until DESC);

CREATE TABLE IF NOT EXISTS server_raid_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('join_burst', 'new_account_join_burst', 'message_burst', 'invite_spike')),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_server_raid_events_server_created
    ON server_raid_events(server_id, created_at DESC);
