-- New accounts should be open to DMs by default for small communities.
-- Existing user preferences are preserved.
ALTER TABLE users
ALTER COLUMN dm_privacy SET DEFAULT 'everyone';
