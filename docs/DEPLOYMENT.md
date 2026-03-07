# Deployment Guide

This guide reflects the **current repository structure**:

- `docker-compose.yml` manages **infrastructure only** (`postgres`, `redis`, `livekit`)
- backend (`apps/server`) runs as a host process/service
- frontend (`apps/web`) builds to static files and is served by Nginx

If you need a fully containerized API/web deployment, create separate Dockerfiles and orchestrator manifests first.

## Prerequisites

- Ubuntu 22.04+ (or equivalent Linux host)
- Docker Engine + Docker Compose v2
- Rust 1.75+
- Node.js 20+
- Nginx
- Domain + DNS control
- TLS certificates (Let's Encrypt recommended)

## 1) Prepare Environment

```bash
git clone https://github.com/emircanagac/voxpery.git
cd voxpery
cp .env.example .env
```

Update `.env`:

```bash
# Database / cache
DATABASE_URL=postgresql://voxpery:<STRONG_PASSWORD>@127.0.0.1:5432/voxpery
REDIS_URL=redis://127.0.0.1:6379

# Backend
SERVER_HOST=127.0.0.1
SERVER_PORT=3001
JWT_SECRET=<RANDOM_32+_BYTE_SECRET>
CORS_ORIGINS=https://your-domain.com,https://www.your-domain.com,https://app.your-domain.com
COOKIE_SECURE=1

# LiveKit
LIVEKIT_WS_URL=wss://livekit.your-domain.com
LIVEKIT_API_KEY=<LIVEKIT_KEY>
LIVEKIT_API_SECRET=<LIVEKIT_SECRET>

# Frontend
VITE_API_URL=https://api.your-domain.com
```

Notes:
- `CORS_ORIGINS` must never contain `*`.
- For non-local origins, `COOKIE_SECURE=1` is required.
- `LIVEKIT_API_SECRET` must match the secret used by your LiveKit server.

## 2) Start Infrastructure

```bash
docker compose up -d
docker compose ps
```

Expected services: `postgres`, `redis`, `livekit`.

## 3) Build and Run Backend

```bash
cd apps/server
cargo build --release
```

Create a systemd unit:

```ini
# /etc/systemd/system/voxpery-server.service
[Unit]
Description=Voxpery Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/voxpery/apps/server
EnvironmentFile=/opt/voxpery/.env
ExecStart=/opt/voxpery/apps/server/target/release/voxpery-server
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

Enable + start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now voxpery-server
sudo systemctl status voxpery-server
```

## 4) Build Frontend

```bash
cd apps/web
npm ci
npm run build
```

Output directory: `apps/web/dist`.

## 5) Configure Nginx

```nginx
upstream voxpery_api {
    server 127.0.0.1:3001;
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 80;
    server_name api.your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    root /opt/voxpery/apps/web/dist;
    index index.html;

    location / {
        try_files $uri /index.html;
    }
}

server {
    listen 443 ssl http2;
    server_name api.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://voxpery_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket upgrade support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## 6) TLS Setup (Let's Encrypt)

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d api.your-domain.com
```

(If LiveKit is exposed via `livekit.your-domain.com`, include it in cert issuance too.)

## 7) Validation Checklist

```bash
# Infra
docker compose ps

# Backend health
curl -f https://api.your-domain.com/health

# Frontend
curl -I https://your-domain.com
```

Manual checks:
- Register/login works in web app
- Channel messaging works
- Voice join works (LiveKit)
- Logout invalidates session

## 8) Operations

### Logs

```bash
docker compose logs -f
sudo journalctl -u voxpery-server -f
```

### Update Procedure

```bash
cd /opt/voxpery
git pull

docker compose up -d

cd apps/web && npm ci && npm run build
cd ../server && cargo build --release
sudo systemctl restart voxpery-server
```

### Backup (PostgreSQL)

```bash
docker compose exec postgres pg_dump -U voxpery voxpery > /var/backups/voxpery-$(date +%F).sql
```

## Common Issues

### CORS errors in browser

- Ensure frontend domain is listed in `CORS_ORIGINS`
- Ensure `COOKIE_SECURE=1` in production (HTTPS)

### API unavailable behind Nginx

- Verify backend is running on `127.0.0.1:3001`
- Check `voxpery-server` service status and logs

### Voice connection fails

- Verify `LIVEKIT_WS_URL` is reachable from clients
- Verify `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` match server config
- Deploy the full `apps/web/dist` (including `dist/assets/`). If the browser requests a worklet script under `/assets/*` and the server returns `index.html` (SPA fallback), voice will fail with errors like "unexpected token: keyword 'class'". Ensure Nginx (or your host) serves real files from `dist` so `/assets/*.js` are the built JS chunks, not the SPA shell.

---

For contributor setup (local dev), see [DEVELOPMENT.md](DEVELOPMENT.md).
For project overview, see [../README.md](../README.md).
