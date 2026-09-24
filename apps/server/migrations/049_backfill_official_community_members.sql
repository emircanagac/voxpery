-- Restore existing unbanned accounts that left the official community before leaving was disabled.
-- Existing membership rows, roles, and joined_at timestamps remain untouched.
INSERT INTO server_members (server_id, user_id, role, joined_at)
SELECT s.id, u.id, 'member', NOW()
FROM servers s
CROSS JOIN users u
WHERE s.invite_code = 'voxpery'
  AND NOT EXISTS (
      SELECT 1 FROM server_bans b WHERE b.server_id = s.id AND b.user_id = u.id
  )
ON CONFLICT (server_id, user_id) DO NOTHING;
