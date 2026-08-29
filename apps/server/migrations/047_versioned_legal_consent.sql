ALTER TABLE users
    ADD COLUMN IF NOT EXISTS kvkk_notice_version TEXT,
    ADD COLUMN IF NOT EXISTS kvkk_notice_acknowledged_at TIMESTAMPTZ;

ALTER TABLE privacy_audit_log
    ADD COLUMN IF NOT EXISTS kvkk_notice_version TEXT;

ALTER TABLE privacy_audit_log
    DROP CONSTRAINT IF EXISTS privacy_audit_log_event_type_check;

ALTER TABLE privacy_audit_log
    ADD CONSTRAINT privacy_audit_log_event_type_check
    CHECK (event_type IN (
        'account_registered',
        'legal_documents_acknowledged',
        'data_export_created'
    ));

COMMENT ON COLUMN users.kvkk_notice_version IS
    'Version of the KVKK notice most recently acknowledged by the user.';

COMMENT ON COLUMN privacy_audit_log.kvkk_notice_version IS
    'KVKK notice version shown for this privacy-safe audit event, when applicable.';
