-- Allow category renames without FK violations by cascading category key updates
-- to category overrides table.

ALTER TABLE channel_category_role_overrides
    DROP CONSTRAINT IF EXISTS channel_category_role_overrides_server_id_category_fkey;

ALTER TABLE channel_category_role_overrides
    ADD CONSTRAINT channel_category_role_overrides_server_id_category_fkey
    FOREIGN KEY (server_id, category)
    REFERENCES server_channel_categories(server_id, name)
    ON DELETE CASCADE
    ON UPDATE CASCADE;
