-- Read receipts for DM channels

CREATE TABLE dm_channel_reads (
    channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_message_id UUID REFERENCES dm_messages(id) ON DELETE SET NULL,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX idx_dm_channel_reads_user ON dm_channel_reads(user_id);

