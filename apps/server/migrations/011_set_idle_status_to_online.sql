-- Idle status removed: treat existing idle users as online
UPDATE users SET status = 'online' WHERE LOWER(status) = 'idle';
