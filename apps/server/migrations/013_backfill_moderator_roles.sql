-- Backfill default "Moderator" role for existing servers.
-- New servers already get this role in application code (create_server handler),
-- but older servers created before the roles system was introduced do not.

INSERT INTO server_roles (server_id, name, color, position, permissions)
SELECT
    s.id AS server_id,
    'Moderator' AS name,
    NULL AS color,
    0 AS position,
    -- Permissions: MANAGE_ROLES | MANAGE_CHANNELS | KICK_MEMBERS | VIEW_AUDIT_LOG | MANAGE_MESSAGES
    -- Bits: 1<<2 (4) | 1<<3 (8) | 1<<4 (16) | 1<<6 (64) | 1<<8 (256) = 348
    348::BIGINT AS permissions
FROM servers s
WHERE NOT EXISTS (
    SELECT 1
    FROM server_roles sr
    WHERE sr.server_id = s.id
      AND LOWER(sr.name) = 'moderator'
);

