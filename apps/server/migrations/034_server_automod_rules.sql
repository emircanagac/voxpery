CREATE TABLE server_automod_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    trigger_type VARCHAR(32) NOT NULL CHECK (trigger_type IN ('blocked_keyword', 'invite_filter', 'link_filter', 'mention_spam')),
    pattern TEXT,
    mention_limit INTEGER,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    exempt_role_ids UUID[] NOT NULL DEFAULT '{}',
    exempt_channel_ids UUID[] NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT server_automod_rule_keyword_pattern CHECK (
        trigger_type <> 'blocked_keyword' OR (pattern IS NOT NULL AND LENGTH(BTRIM(pattern)) BETWEEN 2 AND 128)
    ),
    CONSTRAINT server_automod_rule_mention_limit CHECK (
        trigger_type <> 'mention_spam' OR (mention_limit IS NOT NULL AND mention_limit BETWEEN 2 AND 50)
    )
);

CREATE INDEX idx_server_automod_rules_server_enabled ON server_automod_rules(server_id, enabled, created_at);

