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
- API health endpoint returns `status=ok` (DB + Redis)
- Web endpoint responds

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
