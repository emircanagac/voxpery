-- Personal notes about other users: visible only to their author and removed with either account.

CREATE TABLE IF NOT EXISTS user_notes (
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (author_id, target_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_notes_target ON user_notes (target_user_id);
