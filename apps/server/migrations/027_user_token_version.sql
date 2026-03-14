-- Invalidate all existing sessions when sensitive auth state changes (e.g. password reset/change).
ALTER TABLE users
ADD COLUMN IF NOT EXISTS token_version BIGINT NOT NULL DEFAULT 0;
