-- Ownership is read only from servers.owner_id and permissions only from server roles, so the
-- legacy owner/admin/member flag on memberships is no longer used.

ALTER TABLE server_members DROP COLUMN IF EXISTS role;
