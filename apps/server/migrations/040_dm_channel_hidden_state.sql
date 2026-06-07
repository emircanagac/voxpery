ALTER TABLE dm_channel_members
    ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_dm_channel_members_user_hidden_at
    ON dm_channel_members(user_id, hidden_at);
