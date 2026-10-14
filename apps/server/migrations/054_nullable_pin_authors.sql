-- A deleted user's pins stay pinned: pinned_by_id is cleared by ON DELETE SET NULL, which the
-- NOT NULL constraint from 010_pinned_messages contradicted.

ALTER TABLE channel_pins ALTER COLUMN pinned_by_id DROP NOT NULL;
ALTER TABLE dm_channel_pins ALTER COLUMN pinned_by_id DROP NOT NULL;
