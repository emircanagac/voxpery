ALTER TABLE messages
    ADD COLUMN client_request_id TEXT;

CREATE UNIQUE INDEX uq_messages_client_request
    ON messages(channel_id, user_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

ALTER TABLE dm_messages
    ADD COLUMN client_request_id TEXT;

CREATE UNIQUE INDEX uq_dm_messages_client_request
    ON dm_messages(channel_id, user_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

ALTER TABLE servers
    ADD COLUMN client_request_id TEXT;

CREATE UNIQUE INDEX uq_servers_owner_client_request
    ON servers(owner_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

-- Retain the oldest pending request for each unordered user pair before
-- enforcing atomic uniqueness for future concurrent requests.
WITH ranked_pending_requests AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY LEAST(requester_id, receiver_id), GREATEST(requester_id, receiver_id)
               ORDER BY created_at ASC, id ASC
           ) AS duplicate_rank
    FROM friend_requests
    WHERE status = 'pending'
)
DELETE FROM friend_requests request
USING ranked_pending_requests ranked
WHERE request.id = ranked.id
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX uq_friend_requests_pending_pair
    ON friend_requests(
        LEAST(requester_id, receiver_id),
        GREATEST(requester_id, receiver_id)
    )
    WHERE status = 'pending';
