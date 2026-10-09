CREATE TABLE pending_desktop_registrations (
    cookie_hash TEXT PRIMARY KEY,
    csrf_token TEXT NOT NULL,
    return_origin TEXT NOT NULL,
    redirect_path TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

CREATE INDEX pending_desktop_registrations_expiry
    ON pending_desktop_registrations (expires_at);
