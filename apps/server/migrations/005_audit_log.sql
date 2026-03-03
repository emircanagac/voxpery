-- Moderation-critical audit log: who did what and when (role changes, channel/server destructive actions)

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_id UUID NOT NULL REFERENCES users(id),
    server_id UUID REFERENCES servers(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(20) NOT NULL,
    resource_id UUID,
    details JSONB
);

CREATE INDEX idx_audit_log_server_at ON audit_log(server_id, at DESC);
CREATE INDEX idx_audit_log_actor_at ON audit_log(actor_id, at DESC);

COMMENT ON TABLE audit_log IS 'Moderation audit trail: role changes, channel/server deletions. Queryable by server admins.';
