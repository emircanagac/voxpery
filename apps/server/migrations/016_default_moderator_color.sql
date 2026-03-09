-- Migration 016: set a default color for Moderator roles so they differ from members.
-- Use a Discord-like blurple for visibility in member list.
UPDATE server_roles
SET color = '#5865F2'
WHERE LOWER(name) = 'moderator'
  AND (color IS NULL OR trim(color) = '');

