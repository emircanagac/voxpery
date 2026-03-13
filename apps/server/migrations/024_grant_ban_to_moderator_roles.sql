-- Ensure default Moderator role can ban members.
-- Applies to existing moderator roles as a safe additive backfill.

UPDATE server_roles
SET permissions = permissions | (1 << 5)
WHERE LOWER(name) = 'moderator';
