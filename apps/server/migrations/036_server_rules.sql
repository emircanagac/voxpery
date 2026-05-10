CREATE TABLE IF NOT EXISTS server_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    rule_text TEXT NOT NULL,
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_server_rules_server ON server_rules(server_id);
CREATE INDEX idx_server_rules_position ON server_rules(server_id, position);
