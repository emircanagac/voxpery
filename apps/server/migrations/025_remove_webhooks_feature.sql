-- Remove webhook feature and related permission bit usage.
-- Bit 13 was MANAGE_WEBHOOKS.

-- Clear legacy webhook permission bit from role permissions.
UPDATE server_roles
SET permissions = permissions & ~(1 << 13)
WHERE (permissions & (1 << 13)) <> 0;

-- Defensive cleanup: clear the bit if it was ever written to channel/category overrides.
UPDATE channel_role_overrides
SET allow = allow & ~(1 << 13),
    deny = deny & ~(1 << 13)
WHERE (allow & (1 << 13)) <> 0
   OR (deny & (1 << 13)) <> 0;

UPDATE channel_category_role_overrides
SET allow = allow & ~(1 << 13),
    deny = deny & ~(1 << 13)
WHERE (allow & (1 << 13)) <> 0
   OR (deny & (1 << 13)) <> 0;

-- Drop webhook data table (feature removed).
DROP TABLE IF EXISTS server_webhooks;
