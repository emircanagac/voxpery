# Operations Runbook

Production operations checklist for Voxpery Docker Compose deployments.

Before first use:

```bash
chmod +x scripts/ops/*.sh
```

## 1) Backup Automation (PostgreSQL)

Backup script:

```bash
./scripts/ops/db_backup.sh
```

Restore script:

```bash
RESTORE_CONFIRM=YES ./scripts/ops/db_restore.sh backups/postgres/<file>.sql.gz
```

Recommended cron (daily backup at 02:15 UTC):

```cron
15 2 * * * cd /opt/voxpery && ./scripts/ops/db_backup.sh >> /var/log/voxpery-backup.log 2>&1
```

## 2) Restore Drill (Mandatory Before Public Releases)

At least once per release cycle:

1. Take a fresh backup from production.
2. Restore into a non-production environment.
3. Start stack and verify:
   - login/register
   - at least one server/channel flow
   - voice token minting (`/api/webrtc/livekit-token`)
4. Record drill date and operator in release notes.

## 3) Health and Alerting

Healthcheck script:

```bash
./scripts/ops/stack_healthcheck.sh
./scripts/ops/critical_log_scan.sh
```

This script verifies:

- Compose services are running (`postgres`, `redis`, `livekit`, `server`, `web`)
- Public API health endpoint returns `status=ok`
- PostgreSQL responds through `pg_isready` inside the database container
- Redis responds through `redis-cli ping` inside the Redis container
- Attachment storage exists and is writable inside the server container
- Web endpoint responds

Manual health check:

```bash
curl -fsS http://127.0.0.1:3001/health
```

Expected shape:

```json
{
  "status": "ok"
}
```

The public health endpoint intentionally does not expose dependency names, paths, hostnames, URLs, latency, or configuration state. Use the local ops scripts and server-side Docker commands below for detailed diagnostics.

Recommended alert cron (every 5 minutes):

```cron
*/5 * * * * cd /opt/voxpery && ./scripts/ops/stack_healthcheck.sh && ./scripts/ops/critical_log_scan.sh || echo "Voxpery healthcheck failed"
```

Connect this failure path to your alerting channel (PagerDuty, Opsgenie, Slack webhook, etc.).

## 4) Auth Abuse Hardening Knobs

Environment variables:

- `AUTH_RATE_LIMIT_MAX` (default: `10`)
- `AUTH_RATE_LIMIT_WINDOW_SECS` (default: `60`)
- `LOGIN_FAILURE_MAX_ATTEMPTS` (default: `8`)
- `LOGIN_FAILURE_IP_MAX_ATTEMPTS` (default: `20`)
- `LOGIN_FAILURE_WINDOW_SECS` (default: `900`)

Behavior:

- Sliding-window rate limit still applies.
- Repeated failed login attempts trigger temporary lockouts per identifier and per IP.
- Successful login clears failure counters.

## 5) Log Review

Basic commands:

```bash
docker compose logs --since 15m server
docker compose logs --since 15m livekit
docker compose logs --since 15m web
```

Focus on:

- auth failures and rate-limit spikes
- websocket disconnect surges
- DB/Redis connectivity failures
- LiveKit token/join errors

## 6) Production Triage Commands

Use these commands when the app is unreachable, the backend is restarting, or users report login, voice, or attachment failures.

Container state:

```bash
docker compose ps
docker inspect voxpery-server --format 'ExitCode={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}} RestartCount={{.RestartCount}} StartedAt={{.State.StartedAt}} FinishedAt={{.State.FinishedAt}}'
```

Backend restart loop:

```bash
docker compose logs --tail 200 server
docker compose logs --since 15m server | grep -Ei 'panic|panicked|Failed to run migrations|VersionMismatch|ParseIntError|must be a number|Failed to connect'
```

Database and Redis connectivity:

```bash
docker exec voxpery-db pg_isready -U "${POSTGRES_USER:-voxpery}" -d "${POSTGRES_DB:-voxpery}"
docker exec voxpery-redis redis-cli ping
curl -fsS http://127.0.0.1:3001/health
```

Migration failures:

```bash
docker compose logs --since 30m server | grep -Ei 'Failed to run migrations|VersionMismatch'
docker exec voxpery-db psql -U "${POSTGRES_USER:-voxpery}" -d "${POSTGRES_DB:-voxpery}" -c 'select version, description, installed_on from _sqlx_migrations order by version desc limit 10;'
```

Environment parse failures:

```bash
docker compose logs --since 30m server | grep -Ei 'ParseIntError|must be a number|Invalid .* configuration'
docker compose config >/dev/null
```

LiveKit voice diagnostics:

```bash
docker compose logs --since 15m livekit
docker compose logs --since 15m server | grep -Ei 'LiveKit|Failed to sign LiveKit token|JoinVoice'
```

Attachment diagnostics:

```bash
docker compose logs --since 15m server | grep -Ei 'Attachment|upload|Failed to read attachment|Failed to write attachment|malware|clam'
docker volume inspect voxpery_attachments_data
```

WebSocket disconnect surge:

```bash
docker compose logs --since 15m server | grep -Ei 'WebSocket connected|WebSocket disconnected|Broadcast receiver lagged|WebSocket receive error'
```

## 7) Alert Recommendations

Alert when any of these conditions persist for more than one check window:

- `stack_healthcheck.sh` exits non-zero.
- `critical_log_scan.sh` exits non-zero.
- `voxpery-server` restart count increases repeatedly.
- `/health` returns non-200 or any core dependency (`database`, `redis`, `attachments`) is not `ok`.
- Server logs contain `Failed to run migrations`, `VersionMismatch`, `ParseIntError`, or `must be a number`.
- Server logs show repeated `WebSocket disconnected` surges or `Broadcast receiver lagged` lines.
- Attachment logs show repeated read/write, malware scanner, or upload failures.
