-- Rename legacy user preference value from "offline" to "invisible".
-- Runtime presence still uses "offline" over WebSocket for hidden users.
UPDATE users
SET status = 'invisible'
WHERE lower(status) = 'offline';
