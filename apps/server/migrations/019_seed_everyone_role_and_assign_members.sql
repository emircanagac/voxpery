-- Migration 019: seed default "@everyone" role for all servers
-- and auto-assign it to all existing server members.
--
-- Default @everyone permissions:
-- VIEW_SERVER    (1 << 0)  = 1
-- SEND_MESSAGES  (1 << 7)  = 128
-- CONNECT_VOICE  (1 << 10) = 1024
-- Total = 1153

-- Normalize/ensure @everyone role exists with default baseline permissions.
INSERT INTO server_roles (id, server_id, name, color, position, permissions)
SELECT
    uuid_generate_v4(),
    s.id,
    'Everyone',
    NULL,
    9999,
    1153
FROM servers s
WHERE NOT EXISTS (
    SELECT 1
    FROM server_roles sr
    WHERE sr.server_id = s.id
      AND LOWER(sr.name) = 'everyone'
);

-- If @everyone already exists, align it with baseline defaults.
UPDATE server_roles
SET color = NULL,
    position = 9999,
    permissions = 1153
WHERE LOWER(name) = 'everyone';

-- Assign @everyone role to all current server members (idempotent).
INSERT INTO server_member_roles (server_id, user_id, role_id)
SELECT
    sm.server_id,
    sm.user_id,
    er.id
FROM server_members sm
INNER JOIN server_roles er
    ON er.server_id = sm.server_id
   AND LOWER(er.name) = 'everyone'
ON CONFLICT (server_id, user_id, role_id) DO NOTHING;
