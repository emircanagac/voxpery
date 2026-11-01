-- Group DMs left without an owner by an earlier account deletion go to the longest-standing member.

UPDATE dm_channels c
SET owner_id = (
    SELECT m.user_id
    FROM dm_channel_members m
    WHERE m.channel_id = c.id
    ORDER BY m.joined_at ASC, m.user_id ASC
    LIMIT 1
)
WHERE c.is_group AND c.owner_id IS NULL;
