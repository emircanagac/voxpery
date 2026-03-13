-- Enforce category/channel naming uniqueness rules:
-- 1) Category names are unique per server (case-insensitive).
-- 2) Channel names are unique per (server, category, channel_type) (case-insensitive).

-- Build mapping for category names that only differ by case and keep a canonical one.
CREATE TEMP TABLE tmp_category_canonical_map (
    server_id UUID NOT NULL,
    old_name VARCHAR(100) NOT NULL,
    canonical_name VARCHAR(100) NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_category_canonical_map (server_id, old_name, canonical_name)
SELECT s.server_id, s.name, c.canonical_name
FROM server_channel_categories s
JOIN (
    SELECT server_id, LOWER(name) AS key_name, MIN(name) AS canonical_name
    FROM server_channel_categories
    GROUP BY server_id, LOWER(name)
) c
  ON c.server_id = s.server_id
 AND LOWER(s.name) = c.key_name
WHERE s.name <> c.canonical_name;

-- Re-point channels to canonical category names.
UPDATE channels ch
SET category = m.canonical_name
FROM tmp_category_canonical_map m
WHERE ch.server_id = m.server_id
  AND ch.category = m.old_name;

-- Merge category overrides when case-variants collide.
INSERT INTO channel_category_role_overrides (server_id, category, role_id, allow, deny)
SELECT m.server_id, m.canonical_name, o.role_id, o.allow, o.deny
FROM channel_category_role_overrides o
JOIN tmp_category_canonical_map m
  ON m.server_id = o.server_id
 AND m.old_name = o.category
ON CONFLICT (server_id, category, role_id)
DO UPDATE
SET allow = channel_category_role_overrides.allow | EXCLUDED.allow,
    deny = channel_category_role_overrides.deny | EXCLUDED.deny;

DELETE FROM channel_category_role_overrides o
USING tmp_category_canonical_map m
WHERE o.server_id = m.server_id
  AND o.category = m.old_name;

-- Remove duplicate category rows after remap.
DELETE FROM server_channel_categories s
USING tmp_category_canonical_map m
WHERE s.server_id = m.server_id
  AND s.name = m.old_name;

-- If there are duplicate channels in same scope (case-insensitive), keep the first
-- and auto-rename the rest deterministically.
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY server_id, channel_type, LOWER(COALESCE(category, '')), LOWER(name)
            ORDER BY created_at, id
        ) AS rn
    FROM channels
),
dupes AS (
    SELECT id
    FROM ranked
    WHERE rn > 1
)
UPDATE channels ch
SET name = LEFT(BTRIM(ch.name), 25) || '-' || SUBSTRING(REPLACE(ch.id::TEXT, '-', '') FROM 1 FOR 6)
FROM dupes d
WHERE ch.id = d.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_server_channel_categories_server_name_ci
    ON server_channel_categories(server_id, LOWER(name));

CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_server_category_type_name_ci
    ON channels(server_id, LOWER(COALESCE(category, '')), channel_type, LOWER(name));
