# Database

Voxpery uses PostgreSQL 16+ and SQLx migrations in `apps/server/migrations`.

## Schema Overview

```
users
 +--< server_members >-- servers --< channels --< messages
 |                       |           |          +--< channel_pins
 |                       |           |          +--< message_reactions
 |                       |           +--< channel_role_overrides
 |                       |
 |                       +--< server_roles --< server_member_roles
 |                       +--< server_channel_categories --< channel_category_role_overrides
|                       +--< server_bans
|                       +--< server_reports
|                       +--< server_automod_rules
|                       +--< server_member_timeouts
|                       +--< server_raid_events
|                       +--< audit_log
 |
 +--< friend_requests
 +--< friendships
 +--< password_reset_tokens
 +--< uploaded_attachments
 |
 +--< dm_channel_members >-- dm_channels --< dm_messages --< dm_message_reactions
                             +--< dm_channel_reads
                             +--< dm_channel_pins
```

## Core Tables (Current)

### `users`

Key columns:

- `id`, `username` (unique), `email` (unique), `password_hash`
- `email_verified` (`BOOLEAN`)
- `token_version` (session invalidation counter)
- `avatar_url`
- `status` (string; runtime uses `online`/`dnd`/`offline`)
- `dm_privacy` (`everyone` or `friends`; new accounts default to `everyone`)
- `google_id` (nullable unique)
- `username_changed_at`
- `created_at`

### `servers`

- `id`, `name`, `icon_url`, `description`, `owner_id`, `invite_code`, `created_at`

### `server_onboarding_guides`

- One optional welcome guide row per server.
- Columns: `server_id`, `enabled`, `title`, `body`, `recommended_channel_ids`, `starter_tasks`, `updated_at`
- `recommended_channel_ids` stores up to 6 server channel UUIDs; route validation ensures they belong to the server.
- `starter_tasks` stores up to 6 short checklist items shown to members in the welcome panel.

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
- `description` (nullable text)
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

- `channel_id`, `user_id`, `joined_at`, `hidden_at`
- `hidden_at` stores whether that specific user has hidden the DM from their sidebar.
- Hidden DMs remain intact and are shown again when reopened or when unread messages need attention.

### `dm_messages`

- `id`, `channel_id`, `user_id`, `content`, `attachments`, `edited_at`, `created_at`

### `dm_message_reactions`

- `message_id`, `user_id`, `emoji`, `created_at`

### `dm_channel_reads`

- `channel_id`, `user_id`, `last_read_message_id`, `read_at`
- Used by `GET /api/dm/channels` to derive per-user `unread_count`, and by `DmRead` WebSocket events to synchronize unread badges across sessions.

### `dm_channel_pins`

- `dm_channel_id`, `dm_message_id`, `pinned_by_id`, `pinned_at`

### `audit_log`

- `id`, `at`, `actor_id`, `server_id`, `action`, `resource_type`, `resource_id`, `details`

### `server_bans`

- `server_id`, `user_id`, `banned_by`, `reason`, `created_at`

### `server_reports`

- `id`, `server_id`, `reporter_user_id`, `reported_user_id`
- optional linkage: `channel_id`, `message_id`
- moderation fields: `reason`, `details`, `status`, `resolved_at`, `resolved_by`
- timeline: `created_at`

### `server_automod_rules`

- Server-level AutoMod configuration for blocked keywords, invite links, links, and mention spam.
- Key fields: `trigger_type`, `pattern`, `mention_limit`, `enabled`, `exempt_role_ids`, `exempt_channel_ids`.
- Matching rules block server-channel sends/edits before message persistence and write `automod_message_block` audit entries.

### `server_member_timeouts`

- Active temporary moderation actions keyed by `(server_id, user_id)`.
- Key fields: `timed_out_until`, `timeout_by`, `reason`, `created_at`, `updated_at`.
- Active rows block message sends/edits and new reactions until expiration or moderator clearing.

### `server_raid_events`

- Persistent moderation activity timeline for raid signals.
- `event_type` values: `join_burst`, `new_account_join_burst`, `message_burst`, `invite_spike`.
- Optional linkage: `user_id`, `channel_id`, `metadata`.

### `password_reset_tokens`

- `id`, `user_id` (unique), `token_hash`, `expires_at`, `created_at`

### `email_verification_tokens`

- `user_id` (unique), `email`, `token_hash`, `expires_at`, `created_at`
- Used for new-account verification and verified email changes.

### `uploaded_attachments`

- `id`, `user_id`, `storage_backend`, `storage_key` (unique)
- `original_name`, `content_type`, `size_bytes`, `sha256`
- malware fields: `scan_status`, `malware_signature`
- `created_at`

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
- `027_user_token_version.sql`
- `028_status_offline_to_invisible.sql`
- `029_uploaded_attachments.sql`
- `030_server_reports.sql`
- `031_channel_descriptions.sql`
- `032_user_storage_used_bytes.sql`
- `033_email_verification.sql`
- `034_server_automod_rules.sql`
- `035_server_description.sql`
- `036_server_rules.sql`
- `037_member_timeouts_and_raid_events.sql`
- `038_server_onboarding_guides.sql`
- `039_default_dm_privacy_everyone.sql`
- `040_dm_channel_hidden_state.sql`

## Notes

- Source of truth is migrations plus current route/model usage.
- If docs conflict with SQL in migrations, migrations win.

---

Last verified against code on 2026-04-15.
