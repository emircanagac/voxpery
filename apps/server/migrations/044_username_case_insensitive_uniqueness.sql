-- Preserve display casing while enforcing case-insensitive username identity.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
    ON users (LOWER(username));
