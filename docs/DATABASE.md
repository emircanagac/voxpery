# Database

Voxpery uses PostgreSQL 16+ and SQLx migrations in `apps/server/migrations`.

## Schema Overview

```
users
 ├─< server_members >─ servers ─< channels ─< messages
 │                      │           │          ├─< channel_pins
 │                      │           │          └─< message_reactions
 │                      │           └─< channel_role_overrides
 │                      │
 │                      ├─< server_roles ─< server_member_roles
 │                      ├─< server_channel_categories ─< channel_category_role_overrides
 │                      ├─< server_bans
 │                      └─< audit_log
 │
 ├─< friend_requests
 ├─< friendships
 ├─< password_reset_tokens
 │
 └─< dm_channel_members >─ dm_channels ─< dm_messages ─< dm_message_reactions
                            ├─< dm_channel_reads
                            └─< dm_channel_pins
```

## Core Tables (Current)

### `users`

Key columns:

- `id`, `username` (unique), `email` (unique), `password_hash`
- `avatar_url`
- `status` (string; runtime uses `online`/`dnd`/`offline`)
- `dm_privacy` (`everyone` or `friends` in current backend behavior)
- `google_id` (nullable unique)
- `username_changed_at`
- `created_at`

### `servers`

- `id`, `name`, `icon_url`, `owner_id`, `invite_code`, `created_at`

### `server_members`

- `server_id`, `user_id`, `role`, `joined_at`
- Legacy `role` is bridge-level (`owner` / `member`), while effective authorization comes from role bitmasks.

### `server_roles`

- `id`, `server_id`, `name`, `color`, `position`, `permissions` (`BIGINT`)
- Case-insensitive unique role name per server (`idx_server_roles_server_name`)

### `server_member_roles`

- Many-to-many mapping for role assignments
- Primary key: `(server_id, user_id, role_id)`

### `channels`

- `id`, `server_id`, `name`, `channel_type` (`text` / `voice`)
- `category` (nullable string)
- `position`, `created_at`

Uniqueness (case-insensitive):

- `(server_id, COALESCE(category,''), channel_type, name)` via migration `022`.

### `server_channel_categories`

- Category entities (including empty categories)
- Primary key: `(server_id, name)`
- Position-based ordering

### `channel_role_overrides`

- Channel-level permission overrides per role
- Columns: `channel_id`, `role_id`, `allow`, `deny`

### `channel_category_role_overrides`

- Category-level permission overrides per role
- Columns: `server_id`, `category`, `role_id`, `allow`, `deny`
- FK to `(server_id, name)` in `server_channel_categories`
- Rename-safe FK behavior added in migration `023`.

### `messages`

- `id`, `channel_id`, `user_id`, `content`, `attachments`, `edited_at`, `created_at`

### `message_reactions`

- `message_id`, `user_id`, `emoji`, `created_at`
- One reaction per `(message_id, user_id, emoji)`

### `channel_pins`

- `channel_id`, `message_id`, `pinned_by_id`, `pinned_at`

### `friend_requests`

- `id`, `requester_id`, `receiver_id`, `status`, `created_at`, `responded_at`

### `friendships`

- Canonicalized pair table (`user_a < user_b`)
- Primary key `(user_a, user_b)`

### `dm_channels`

- `id`, `created_at`

### `dm_channel_members`

- `channel_id`, `user_id`, `joined_at`

### `dm_messages`

- `id`, `channel_id`, `user_id`, `content`, `attachments`, `edited_at`, `created_at`

### `dm_message_reactions`

- `message_id`, `user_id`, `emoji`, `created_at`

### `dm_channel_reads`

- `channel_id`, `user_id`, `last_read_message_id`, `read_at`

### `dm_channel_pins`

- `dm_channel_id`, `dm_message_id`, `pinned_by_id`, `pinned_at`

### `audit_log`

- `id`, `at`, `actor_id`, `server_id`, `action`, `resource_type`, `resource_id`, `details`

### `server_bans`

- `server_id`, `user_id`, `banned_by`, `reason`, `created_at`

### `password_reset_tokens`

- `id`, `user_id` (unique), `token_hash`, `expires_at`, `created_at`

## Removed/Deprecated

- `server_webhooks` was created in migration `021` and removed in migration `025`.
- Webhook permission bit cleanup also happened in migration `025`.

## Migrations

All migrations currently present:

- `001_initial.sql`
- `002_friends.sql`
- `003_dm.sql`
- `004_dm_reads.sql`
- `005_audit_log.sql`
- `006_dm_privacy.sql`
- `007_rename_admin_to_moderator.sql`
- `008_google_oauth.sql`
- `009_username_changed_at.sql`
- `010_pinned_messages.sql`
- `011_set_idle_status_to_online.sql`
- `012_roles_and_permissions.sql`
- `013_backfill_moderator_roles.sql`
- `014_legacy_role_admin.sql`
- `015_collapse_admin_to_member.sql`
- `016_default_moderator_color.sql`
- `017_password_reset_tokens.sql`
- `018_update_default_moderator_permissions.sql`
- `019_seed_everyone_role_and_assign_members.sql`
- `020_channel_categories_and_overrides.sql`
- `021_bans_and_webhooks.sql`
- `022_channel_name_and_category_uniqueness.sql`
- `023_category_override_fk_on_update_cascade.sql`
- `024_grant_ban_to_moderator_roles.sql`
- `025_remove_webhooks_feature.sql`
- `026_message_reactions.sql`

## Notes

- Source of truth is migrations plus current route/model usage.
- If docs conflict with SQL in migrations, migrations win.

---

Last verified against code on 2026-03-14.
