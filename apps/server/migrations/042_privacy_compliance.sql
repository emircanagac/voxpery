ALTER TABLE users
    ADD COLUMN IF NOT EXISTS terms_version TEXT,
    ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS privacy_notice_version TEXT,
    ADD COLUMN IF NOT EXISTS privacy_notice_acknowledged_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS privacy_audit_log (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('account_registered', 'data_export_created')),
    terms_version TEXT,
    privacy_notice_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_privacy_audit_user_created
    ON privacy_audit_log (user_id, created_at DESC);

COMMENT ON TABLE privacy_audit_log IS
    'Privacy-safe proof of legal document acknowledgement and self-service export generation. Never store message content, credentials, IP addresses, or archive paths here.';
