ALTER TABLE users
ADD COLUMN IF NOT EXISTS storage_used_bytes BIGINT NOT NULL DEFAULT 0;

UPDATE users u
SET storage_used_bytes = COALESCE((
    SELECT SUM(ua.size_bytes)::BIGINT
    FROM uploaded_attachments ua
    WHERE ua.user_id = u.id
      AND ua.scan_status = 'clean'
), 0);
