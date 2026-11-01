-- Substring message search: trigram indexes let ILIKE '%term%' avoid reading a whole channel.
-- pg_trgm is a trusted extension, so the application role can install it.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_messages_content_trgm
    ON messages USING GIN (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_dm_messages_content_trgm
    ON dm_messages USING GIN (content gin_trgm_ops);
