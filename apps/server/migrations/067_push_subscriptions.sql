-- Web Push subscriptions: one row per browser that turned on notifications for when Voxpery is
-- closed. The endpoint is a capability URL of the browser's push service; it is never logged.

-- One row per browser. endpoint is unique: when another account signs in on the same
-- browser the row moves to that account (ON CONFLICT (endpoint) DO UPDATE SET user_id ...).
-- The application allows at most 10 rows per user.
CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL CHECK (char_length(endpoint) BETWEEN 1 AND 2048),
    p256dh TEXT NOT NULL CHECK (char_length(p256dh) BETWEEN 1 AND 128),
    auth TEXT NOT NULL CHECK (char_length(auth) BETWEEN 1 AND 64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
