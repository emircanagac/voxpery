-- Release uploads that no message uses and return their storage quota.
--
-- last_claimed_at: when the file was last uploaded (an identical re-upload reuses the row).
-- Unsent uploads are kept for a grace period after it, so files of a message still being
-- written are not removed.
-- release_check_at: when the server checks next whether the upload is still used; NULL once
-- it was found in use. Deleting a message (directly or with its channel or server) sets it for
-- the message's files.

ALTER TABLE uploaded_attachments
    ADD COLUMN IF NOT EXISTS last_claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS release_check_at TIMESTAMPTZ DEFAULT NOW();

-- Existing uploads: the grace period counts from the original upload, and each is checked once.
UPDATE uploaded_attachments SET last_claimed_at = created_at;

CREATE INDEX IF NOT EXISTS idx_uploaded_attachments_release_check
    ON uploaded_attachments (release_check_at)
    WHERE release_check_at IS NOT NULL;

-- Older messages may reference a file by URL only. Add its id so "in use" checks, which match
-- on id, see every reference.
CREATE FUNCTION migration_055_with_attachment_ids(refs JSONB) RETURNS JSONB
LANGUAGE sql STABLE AS $$
    SELECT jsonb_agg(
        CASE
            WHEN jsonb_typeof(item) = 'object' AND NOT item ? 'id' AND resolved.id IS NOT NULL
                THEN item || jsonb_build_object('id', resolved.id::text)
            ELSE item
        END
        ORDER BY position
    )
    FROM jsonb_array_elements(refs) WITH ORDINALITY AS t(item, position)
    LEFT JOIN LATERAL (
        SELECT ua.id
        FROM uploaded_attachments ua
        WHERE jsonb_typeof(item) = 'object'
          AND (
              ua.id = substring(
                  item->>'url'
                  from '/api/attachments/content/([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})'
              )::uuid
              OR ua.storage_key = substring(item->>'url' from '/uploads/([^?#]+)')
          )
        LIMIT 1
    ) AS resolved ON TRUE
$$;

UPDATE messages
SET attachments = migration_055_with_attachment_ids(attachments)
WHERE jsonb_typeof(attachments) = 'array'
  AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(attachments) AS item
      WHERE jsonb_typeof(item) = 'object' AND NOT item ? 'id' AND item ? 'url'
  );

UPDATE dm_messages
SET attachments = migration_055_with_attachment_ids(attachments)
WHERE jsonb_typeof(attachments) = 'array'
  AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(attachments) AS item
      WHERE jsonb_typeof(item) = 'object' AND NOT item ? 'id' AND item ? 'url'
  );

DROP FUNCTION migration_055_with_attachment_ids(JSONB);

-- "Is this upload still used?" looks up messages by attachment id.
CREATE INDEX IF NOT EXISTS idx_messages_attachments
    ON messages USING GIN (attachments jsonb_path_ops)
    WHERE attachments IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dm_messages_attachments
    ON dm_messages USING GIN (attachments jsonb_path_ops)
    WHERE attachments IS NOT NULL;

CREATE OR REPLACE FUNCTION queue_attachment_release_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF jsonb_typeof(OLD.attachments) = 'array' THEN
        UPDATE uploaded_attachments
        SET release_check_at = NOW()
        WHERE id IN (
            SELECT (item->>'id')::uuid
            FROM jsonb_array_elements(OLD.attachments) AS item
            WHERE jsonb_typeof(item) = 'object'
              AND item->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        );
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER messages_queue_attachment_release_check
    AFTER DELETE ON messages
    FOR EACH ROW EXECUTE FUNCTION queue_attachment_release_check();
CREATE TRIGGER dm_messages_queue_attachment_release_check
    AFTER DELETE ON dm_messages
    FOR EACH ROW EXECUTE FUNCTION queue_attachment_release_check();

-- The quota is the size of the clean uploads a user still has.
UPDATE users u
SET storage_used_bytes = COALESCE((
    SELECT SUM(ua.size_bytes)::BIGINT
    FROM uploaded_attachments ua
    WHERE ua.user_id = u.id AND ua.scan_status = 'clean'
), 0)
WHERE u.storage_used_bytes <> COALESCE((
    SELECT SUM(ua.size_bytes)::BIGINT
    FROM uploaded_attachments ua
    WHERE ua.user_id = u.id AND ua.scan_status = 'clean'
), 0);
