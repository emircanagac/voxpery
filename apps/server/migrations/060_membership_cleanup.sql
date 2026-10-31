-- Roles belong to a membership: they end with it, so a former member cannot get them back by
-- rejoining. Rows left by earlier kicks and departures are removed first.
DELETE FROM server_member_roles smr
WHERE NOT EXISTS (
    SELECT 1 FROM server_members sm
    WHERE sm.server_id = smr.server_id AND sm.user_id = smr.user_id
);

ALTER TABLE server_member_roles
    ADD CONSTRAINT server_member_roles_membership_fkey
    FOREIGN KEY (server_id, user_id)
    REFERENCES server_members (server_id, user_id)
    ON DELETE CASCADE;

-- A server mute or deafen outlives the membership and returns with the member.
CREATE TABLE server_voice_moderation_holds (
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    voice_server_muted BOOLEAN NOT NULL,
    voice_server_deafened BOOLEAN NOT NULL,
    PRIMARY KEY (server_id, user_id)
);

CREATE INDEX idx_server_voice_moderation_holds_user
    ON server_voice_moderation_holds(user_id);

-- When a friendship ended. A friends-only account is reachable by someone it wrote to, but only
-- for what it wrote after this point.
CREATE TABLE dm_friendship_ends (
    user_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_a, user_b),
    CHECK (user_a < user_b)
);

CREATE INDEX idx_dm_friendship_ends_user_b ON dm_friendship_ends(user_b);
