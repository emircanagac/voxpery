-- The internal account that keeps a deleted user's servers and history is identified by a flag
-- instead of its email address, which a user could register before the first account deletion.
-- Only an account the server created itself is flagged: it never accepted the legal documents
-- and carries the generated username.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users
SET is_system = TRUE
WHERE id = (
    SELECT id
    FROM users
    WHERE lower(email) = 'deleted@system.local'
      AND username LIKE 'deleted\_system%'
      AND google_id IS NULL
      AND terms_version IS NULL
      AND privacy_notice_version IS NULL
    ORDER BY created_at, id
    LIMIT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_system_account
    ON users (is_system)
    WHERE is_system;

-- Category overrides are keyed by name. Deleting a category left them behind, so a new category
-- with the same name inherited them; drop the ones whose category no longer exists.
DELETE FROM channel_category_role_overrides o
WHERE NOT EXISTS (
        SELECT 1
        FROM server_channel_categories c
        WHERE c.server_id = o.server_id
          AND c.name = o.category
    )
  AND NOT EXISTS (
        SELECT 1
        FROM channels ch
        WHERE ch.server_id = o.server_id
          AND ch.category = o.category
    );

-- Join-burst raid signals stored the joining member's IP address, which the privacy notice says
-- is never kept in the database.
UPDATE server_raid_events
SET metadata = metadata - 'client_ip'
WHERE metadata ? 'client_ip';

UPDATE audit_log
SET details = details - 'client_ip'
WHERE action IN ('raid_join_burst', 'raid_new_account_join_burst')
  AND details ? 'client_ip';

-- Local files whose rows were deleted (account deletion, released uploads) are queued here in
-- the same transaction and removed after the commit; an entry stays until its file is gone, so
-- a failed removal is retried instead of leaving the file on disk.
CREATE TABLE IF NOT EXISTS pending_file_deletions (
    storage_key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
