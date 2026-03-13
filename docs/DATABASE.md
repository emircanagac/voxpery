# Database

Voxpery uses **PostgreSQL 16+** for all persistent data.

## Schema Overview

```
users ──┬──< server_members ──> servers ──< channels
        │                                      │
        ├──< friend_requests                   ├──< messages
        ├──< friends                           │
        │                                      │
        └──< dm_channel_members ──> dm_channels
                                        │
                                        └──< dm_messages
                                        └──< dm_read_state
```

## Tables

### `users`

Primary user accounts.

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(32) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,  -- Argon2id
    status VARCHAR(20) DEFAULT 'online' CHECK (status IN ('online', 'idle', 'dnd', 'offline')),
    avatar_url TEXT,
    dm_privacy VARCHAR(20) DEFAULT 'everyone' CHECK (dm_privacy IN ('everyone', 'friends', 'server_members')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_status ON users(status);
```

### `servers`

Discord-like servers (guilds).

```sql
CREATE TABLE servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_code VARCHAR(16) UNIQUE NOT NULL,  -- For joining via link
    icon_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_servers_owner ON servers(owner_id);
CREATE INDEX idx_servers_invite_code ON servers(invite_code);
```

### `server_members`

User membership in servers.

```sql
CREATE TABLE server_members (
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (server_id, user_id)
);

CREATE INDEX idx_server_members_user ON server_members(user_id);
CREATE INDEX idx_server_members_role ON server_members(server_id, role);
```

### `server_roles`

Server-scoped roles with bitmask permissions.

```sql
CREATE TABLE server_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    color VARCHAR(16),
    position INTEGER NOT NULL DEFAULT 0,
    permissions BIGINT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_server_roles_server_name
    ON server_roles(server_id, LOWER(name));
```

### `server_member_roles`

Many-to-many role assignments per member.

```sql
CREATE TABLE server_member_roles (
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES server_roles(id) ON DELETE CASCADE,
    PRIMARY KEY (server_id, user_id, role_id)
);

CREATE INDEX idx_server_member_roles_user
    ON server_member_roles(user_id);
```

### `channel_role_overrides`

Channel-level allow/deny overrides for roles.

```sql
CREATE TABLE channel_role_overrides (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES server_roles(id) ON DELETE CASCADE,
    allow BIGINT NOT NULL DEFAULT 0,
    deny BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, role_id)
);
```

### `channels`

Text and voice channels within servers.

```sql
CREATE TABLE channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    channel_type VARCHAR(10) NOT NULL CHECK (channel_type IN ('text', 'voice')),
    position INT NOT NULL DEFAULT 0,  -- Display order
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_channels_server ON channels(server_id, position);
CREATE INDEX idx_channels_type ON channels(server_id, channel_type);
```

### `messages`

Server channel messages.

```sql
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    attachments JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE INDEX idx_messages_channel_time ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_author ON messages(author_id);
CREATE INDEX idx_messages_content_search ON messages USING gin(to_tsvector('english', content));
```

### `friends` & `friend_requests`

Friend relationships.

```sql
CREATE TABLE friend_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (requester_id, receiver_id),
    CHECK (requester_id != receiver_id)
);

CREATE TABLE friends (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, friend_id),
    CHECK (user_id < friend_id)  -- Ensure only one row per friendship
);

CREATE INDEX idx_friends_user ON friends(user_id);
CREATE INDEX idx_friends_friend ON friends(friend_id);
```

### `dm_channels`, `dm_messages`, `dm_channel_members`

Direct messages (1:1).

```sql
CREATE TABLE dm_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE dm_channel_members (
    channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE dm_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    attachments JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE INDEX idx_dm_messages_channel_time ON dm_messages(channel_id, created_at DESC);
CREATE INDEX idx_dm_channel_members_user ON dm_channel_members(user_id);
```

### `dm_read_state`

Tracks last-read message in DM channels.

```sql
CREATE TABLE dm_read_state (
    channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_message_id UUID REFERENCES dm_messages(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, user_id)
);
```

### `audit_log`

Moderation actions (kick, ban, role change).

```sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,  -- 'kick', 'set_role', 'delete_message', etc.
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_server ON audit_log(server_id, created_at DESC);
```

## Migrations

Versioned SQL files in `apps/server/migrations/`:

- `001_initial.sql` — Core tables (users, servers, channels, messages)
- `002_friends.sql` — Friend system
- `003_dm.sql` — Direct messages
- `004_dm_reads.sql` — Read state tracking
- `005_audit_log.sql` — Moderation log
- `006_dm_privacy.sql` — DM privacy settings
- `007_rename_admin_to_moderator.sql` — Rename `admin` role to `moderator`
- `012_roles_and_permissions.sql` — Bitmask role system (`server_roles`, `server_member_roles`, overrides)
- `015_collapse_admin_to_member.sql` — Normalize `server_members.role` bridge to `owner/member`
- `019_seed_everyone_role_and_assign_members.sql` — Seed and assign default `Everyone` role

**Run migrations**: Backend auto-runs on startup via `sqlx::migrate!("./migrations").run(&db).await`.

## Key Queries

### Get user's servers

```sql
SELECT s.*
FROM servers s
INNER JOIN server_members sm ON s.id = sm.server_id
WHERE sm.user_id = $1
ORDER BY s.created_at;
```

### Get channels for a server

```sql
SELECT * FROM channels
WHERE server_id = $1
ORDER BY position, created_at;
```

### Load messages (paginated)

```sql
SELECT m.*, u.username, u.avatar_url
FROM messages m
LEFT JOIN users u ON m.author_id = u.id
WHERE m.channel_id = $1
  AND ($2::UUID IS NULL OR m.created_at < (SELECT created_at FROM messages WHERE id = $2))
ORDER BY m.created_at DESC
LIMIT $3;
```

### Check server membership

```sql
SELECT EXISTS(
  SELECT 1 FROM server_members
  WHERE server_id = $1 AND user_id = $2
);
```

### Get DM channel between two users

```sql
SELECT c.id
FROM dm_channels c
JOIN dm_channel_members m1 ON c.id = m1.channel_id AND m1.user_id = $1
JOIN dm_channel_members m2 ON c.id = m2.channel_id AND m2.user_id = $2;
```

## Performance

- **Indexes**: All foreign keys + query patterns covered
- **Connection pool**: Max 20 connections (Axum async runtime)
- **Prepared statements**: SQLx caches at compile-time
- **Pagination**: Cursor-based (`before` message ID) for infinite scroll

## Backup & Restore

**Backup**:
```bash
pg_dump -U voxpery -h localhost voxpery > backup.sql
```

**Restore**:
```bash
psql -U voxpery -h localhost voxpery < backup.sql
```

**Scheduled backup** (cron):
```bash
0 2 * * * pg_dump -U voxpery voxpery | gzip > /backups/voxpery-$(date +\%Y\%m\%d).sql.gz
```

## Development

**Reset database**:
```bash
psql -U postgres -c "DROP DATABASE voxpery;"
psql -U postgres -c "CREATE DATABASE voxpery;"
cargo run  # Migrations run on startup
```

**Query database**:
```bash
psql -U voxpery -d voxpery
```
