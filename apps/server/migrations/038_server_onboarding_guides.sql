CREATE TABLE IF NOT EXISTS server_onboarding_guides (
    server_id UUID PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    recommended_channel_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    starter_tasks TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
