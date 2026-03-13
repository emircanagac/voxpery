-- Persist server channel categories (including empty ones) and allow
-- category-level role overrides that apply to all channels in that category.

CREATE TABLE IF NOT EXISTS server_channel_categories (
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (server_id, name)
);

CREATE INDEX IF NOT EXISTS idx_server_channel_categories_server_position
    ON server_channel_categories(server_id, position, name);

-- Backfill existing categories from channels table so old servers gain
-- category entities immediately.
INSERT INTO server_channel_categories (server_id, name, position)
SELECT server_id, category, 0
FROM channels
WHERE category IS NOT NULL AND BTRIM(category) <> ''
ON CONFLICT (server_id, name) DO NOTHING;

CREATE TABLE IF NOT EXISTS channel_category_role_overrides (
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    category VARCHAR(100) NOT NULL,
    role_id UUID NOT NULL REFERENCES server_roles(id) ON DELETE CASCADE,
    allow BIGINT NOT NULL DEFAULT 0,
    deny BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (server_id, category, role_id),
    FOREIGN KEY (server_id, category)
        REFERENCES server_channel_categories(server_id, name)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_channel_category_overrides_server_category
    ON channel_category_role_overrides(server_id, category);
