ALTER TABLE dm_channel_members
    ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_dm_channel_members_user_pinned_at
    ON dm_channel_members(user_id, pinned_at DESC)
    WHERE pinned_at IS NOT NULL;
