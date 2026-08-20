-- Stores the last username change; the API currently enforces a seven-day cooldown.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;
