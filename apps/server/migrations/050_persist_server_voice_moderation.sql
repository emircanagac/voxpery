ALTER TABLE server_members
    ADD COLUMN voice_server_muted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN voice_server_deafened BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN server_members.voice_server_muted IS
    'Server-enforced voice mute, retained across voice sessions until a moderator removes it.';
COMMENT ON COLUMN server_members.voice_server_deafened IS
    'Server-enforced voice deafen, retained across voice sessions until a moderator removes it.';
