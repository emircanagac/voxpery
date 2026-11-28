-- An operator can disable an account (no admin screen yet; see docs/DEPLOYMENT.md).
-- A disabled account cannot sign in, and every session check treats it as signed out: REST
-- at once, open WebSockets at their next 30-second session check. NULL means active.
ALTER TABLE users
    ADD COLUMN disabled_at TIMESTAMPTZ;

-- The deleted-account placeholder (is_system) holds deleted users' servers and records; an
-- operator's UPDATE must not catch it, so it always stays enabled.
ALTER TABLE users
    ADD CONSTRAINT users_system_account_not_disabled
    CHECK (NOT (is_system AND disabled_at IS NOT NULL));
