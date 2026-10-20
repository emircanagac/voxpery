-- Uploaded avatars are stored as data URLs of up to 1 MB. Lists (direct messages, friends,
-- members, message authors) now return a short, cacheable URL for them instead of repeating the
-- image inline; GET /api/images/users/{id}/avatar serves the stored image. The version changes
-- whenever the stored image does, so clients can cache each URL indefinitely.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar_version TEXT
    GENERATED ALWAYS AS (
        CASE WHEN avatar_url LIKE 'data:%' THEN left(md5(avatar_url), 16) END
    ) STORED;

-- Inlined by the planner, so the stored data URL is only read for avatars that are not data URLs.
CREATE OR REPLACE FUNCTION public_avatar_url(user_id UUID, avatar_version TEXT, avatar_url TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN avatar_version IS NOT NULL
            THEN '/api/images/users/' || user_id::text || '/avatar?v=' || avatar_version
        ELSE avatar_url
    END
$$;
