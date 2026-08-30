-- Add structured voice moderation context and a dedicated move-members permission.

ALTER TABLE audit_log
    ADD COLUMN channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
    ADD COLUMN reason VARCHAR(500);

CREATE INDEX idx_audit_log_server_action_at
    ON audit_log(server_id, action, at DESC, id DESC);

CREATE INDEX idx_audit_log_server_resource_at
    ON audit_log(server_id, resource_id, at DESC, id DESC);

CREATE INDEX idx_audit_log_server_channel_at
    ON audit_log(server_id, channel_id, at DESC, id DESC);

COMMENT ON COLUMN audit_log.channel_id IS
    'Voice or text channel context for the audited action when one applies.';
COMMENT ON COLUMN audit_log.reason IS
    'Optional moderator-supplied reason, limited to 500 characters.';

-- Bit 13 was previously used by the removed webhook feature and was cleared in migration 025.
-- Existing custom roles are intentionally not granted this new moderation capability.
