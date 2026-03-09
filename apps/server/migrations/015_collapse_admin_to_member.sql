-- Migration 015: collapse legacy admin/moderator roles to simple member, and normalize role names.
-- 1) Legacy bridge: only 'owner' and 'member' are used in server_members.role now.
UPDATE server_members SET role = 'member' WHERE role IN ('moderator', 'admin');

-- 2) If any server_roles were previously seeded as 'Admin', rename them to 'Moderator' for consistency.
UPDATE server_roles SET name = 'Moderator' WHERE LOWER(name) = 'admin';

