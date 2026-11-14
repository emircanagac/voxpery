-- Edit records in audit_log keep the first 160 characters of the old and new message text, and
-- AutoMod block records keep the blocked text. That text must not outlive the message or the
-- account it came from. This migration adds the indexes the cleanup needs and removes what is
-- already left over; the server keeps it clean from here on and deletes audit records older
-- than 180 days in batches (not here, so the migration never holds a long lock).

-- Finds the edit records of one message when it is deleted, and the records whose message is
-- already gone.
CREATE INDEX IF NOT EXISTS idx_audit_log_message_edit_resource
    ON audit_log(resource_id)
    WHERE action = 'message_edit';

-- Serves the periodic retention delete.
CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at);

-- Edit records of messages that no longer exist: drop the quoted text. The flags (changed,
-- *_truncated) and channel_id stay.
UPDATE audit_log a
SET details = a.details - 'before_preview' - 'after_preview'
WHERE a.action = 'message_edit'
  AND a.details ?| ARRAY['before_preview', 'after_preview']
  AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = a.resource_id)
  AND NOT EXISTS (SELECT 1 FROM dm_messages d WHERE d.id = a.resource_id);

-- AutoMod block records name the author as the actor. Account deletion moved them to the
-- system placeholder account, so records held by it belong to deleted accounts: drop the
-- blocked text and the matched part of it. The rule and trigger stay.
UPDATE audit_log a
SET details = a.details - 'content_preview' - 'matched_value'
WHERE a.action = 'automod_message_block'
  AND a.details ?| ARRAY['content_preview', 'matched_value']
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = a.actor_id AND u.is_system);
