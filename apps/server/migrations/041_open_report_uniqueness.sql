-- Collapse legacy duplicate open reports before enforcing atomic uniqueness.
WITH ranked_user_reports AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY server_id, reporter_user_id, reported_user_id
               ORDER BY created_at ASC, id ASC
           ) AS duplicate_rank
    FROM server_reports
    WHERE status = 'open'
      AND message_id IS NULL
      AND message_excerpt IS NULL
)
DELETE FROM server_reports report
USING ranked_user_reports ranked
WHERE report.id = ranked.id
  AND ranked.duplicate_rank > 1;

WITH ranked_message_reports AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY server_id, reporter_user_id, message_id
               ORDER BY created_at ASC, id ASC
           ) AS duplicate_rank
    FROM server_reports
    WHERE status = 'open'
      AND message_id IS NOT NULL
)
DELETE FROM server_reports report
USING ranked_message_reports ranked
WHERE report.id = ranked.id
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX uq_server_reports_open_user
    ON server_reports(server_id, reporter_user_id, reported_user_id)
    WHERE status = 'open'
      AND message_id IS NULL
      AND message_excerpt IS NULL;

CREATE UNIQUE INDEX uq_server_reports_open_message
    ON server_reports(server_id, reporter_user_id, message_id)
    WHERE status = 'open'
      AND message_id IS NOT NULL;
