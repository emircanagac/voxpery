-- Per-user DM privacy setting
-- everyone: anyone can open DM
-- friends: only friends can open DM (default)
-- server_members: users sharing at least one server can open DM

ALTER TABLE users
ADD COLUMN dm_privacy VARCHAR(20) NOT NULL DEFAULT 'friends';

CREATE INDEX idx_users_dm_privacy ON users(dm_privacy);
