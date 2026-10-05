CREATE TABLE pending_google_registrations (
    cookie_hash TEXT PRIMARY KEY,
    csrf_token TEXT NOT NULL,
    google_id TEXT NOT NULL,
    email TEXT NOT NULL,
    username_seed TEXT NOT NULL,
    return_origin TEXT NOT NULL,
    redirect_path TEXT NOT NULL,
    code_challenge TEXT,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);
CREATE INDEX pending_google_registrations_expiry ON pending_google_registrations (expires_at);
