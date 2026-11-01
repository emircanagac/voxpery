-- Uploaded avatars move from data URLs of up to 1 MB in users.avatar_url to the attachment file
-- storage, so rows and database backups stop carrying the images. avatar_url then holds
-- file:<version>, which keeps avatar_version and public_avatar_url working. A background job
-- moves existing data URLs and keeps their version, so cached image URLs stay valid.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar_file_backend TEXT CHECK (avatar_file_backend IN ('local', 's3')),
    ADD COLUMN IF NOT EXISTS avatar_file_key TEXT;

ALTER TABLE users DROP COLUMN avatar_version;
ALTER TABLE users
    ADD COLUMN avatar_version TEXT
    GENERATED ALWAYS AS (
        CASE
            WHEN avatar_url LIKE 'data:%' THEN left(md5(avatar_url), 16)
            WHEN avatar_url LIKE 'file:%' THEN substr(avatar_url, 6)
        END
    ) STORED;
