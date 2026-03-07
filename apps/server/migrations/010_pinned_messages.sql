-- Pinned messages: DM channels and server text channels

CREATE TABLE dm_channel_pins (
    dm_channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    dm_message_id UUID NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
    pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pinned_by_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (dm_channel_id, dm_message_id)
);

CREATE INDEX idx_dm_channel_pins_channel ON dm_channel_pins(dm_channel_id);

CREATE TABLE channel_pins (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pinned_by_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (channel_id, message_id)
);

CREATE INDEX idx_channel_pins_channel ON channel_pins(channel_id);
