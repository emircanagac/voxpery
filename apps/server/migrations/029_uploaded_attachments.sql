CREATE TABLE IF NOT EXISTS uploaded_attachments (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_backend TEXT NOT NULL CHECK (storage_backend IN ('local', 's3')),
    storage_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    sha256 TEXT NOT NULL,
    scan_status TEXT NOT NULL CHECK (scan_status IN ('clean', 'infected', 'failed')),
    malware_signature TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uploaded_attachments_user_created
    ON uploaded_attachments (user_id, created_at DESC);
