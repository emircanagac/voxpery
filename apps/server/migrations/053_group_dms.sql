-- Group direct messages: a DM channel with several members, an optional name and an owner.
-- Existing DM channels stay one-to-one (is_group = FALSE).

ALTER TABLE dm_channels
    ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE dm_channels
    ADD CONSTRAINT dm_channels_group_name_length
    CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 64);
