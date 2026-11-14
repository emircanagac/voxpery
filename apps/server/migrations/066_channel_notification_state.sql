-- Unread and mention state of server channels moves from each client's memory to the server, so
-- badges survive a closed app and agree between devices. Muted servers and channels move with
-- them.

-- @everyone / @here set one flag instead of one row per member.
ALTER TABLE messages ADD COLUMN mention_everyone BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_messages_channel_mention_everyone
    ON messages(channel_id, created_at)
    WHERE mention_everyone;

-- How far a user has read a server channel. last_read_at is the created_at of the last read
-- message (not the time of reading), so a message that arrives while the request is on its
-- way is never marked read by accident. A channel without a row counts as read up to
-- server_members.joined_at.
-- Marking is forward-only:
--   INSERT ... ON CONFLICT (user_id, channel_id) DO UPDATE SET ...
--   WHERE channel_reads.last_read_at < EXCLUDED.last_read_at
CREATE TABLE channel_reads (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    last_read_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    last_read_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX idx_channel_reads_channel ON channel_reads(channel_id);

-- Mentions by name. channel_id and created_at repeat the message's own values (both never
-- change), so the per-channel mention count is one index scan without joining messages.
-- Rewritten in the same transaction when the message is edited.
CREATE TABLE message_mentions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX idx_message_mentions_user_channel
    ON message_mentions(user_id, channel_id, created_at);

-- A muted server or a muted channel: exactly one of the two is set.
CREATE TABLE notification_mutes (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT notification_mutes_one_target CHECK (num_nonnulls(server_id, channel_id) = 1)
);

CREATE UNIQUE INDEX idx_notification_mutes_user_server
    ON notification_mutes(user_id, server_id)
    WHERE server_id IS NOT NULL;

CREATE UNIQUE INDEX idx_notification_mutes_user_channel
    ON notification_mutes(user_id, channel_id)
    WHERE channel_id IS NOT NULL;

-- Rows of a server the user left stay (they are small and apply again on rejoin); account
-- deletion removes them through the cascades.
