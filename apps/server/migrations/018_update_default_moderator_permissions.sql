-- Migration 018: normalize default Moderator role permissions.
-- Applies to existing servers as requested, including the default Voxpery server.
--
-- New default Moderator permissions:
-- VIEW_AUDIT_LOG   (1 << 6)   = 64
-- MANAGE_MESSAGES  (1 << 8)   = 256
-- MANAGE_PINS      (1 << 9)   = 512
-- KICK_MEMBERS     (1 << 4)   = 16
-- MUTE_MEMBERS     (1 << 11)  = 2048
-- DEAFEN_MEMBERS   (1 << 12)  = 4096
-- Total = 6992

UPDATE server_roles
SET permissions = 6992
WHERE LOWER(name) = 'moderator';
