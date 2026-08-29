-- Optional public profile text visible only through authenticated
-- server-member responses, alongside existing member identity fields.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS about_me VARCHAR(190) NOT NULL DEFAULT '';
