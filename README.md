<div align="center">

# <img src="apps/web/public/1024.png" alt="Voxpery" width="36" height="36" style="vertical-align: -0.15em;" /> Voxpery <img src="apps/web/public/1024.png" alt="Voxpery" width="36" height="36" style="vertical-align: -0.15em;" />

**Open-source, privacy-first communication platform**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)
[![CI](https://github.com/emircanagac/voxpery/actions/workflows/ci.yml/badge.svg)](https://github.com/emircanagac/voxpery/actions/workflows/ci.yml)
[![Discussions](https://img.shields.io/badge/Community-GitHub%20Discussions-2ea44f.svg)](https://github.com/emircanagac/voxpery/discussions)
[![Rust](https://img.shields.io/badge/Backend-Rust-orange.svg)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/Frontend-React-61DAFB.svg)](https://react.dev/)

*Your data is yours. Voice, text, and real-time presence.*

**[→ Use at voxpery.com](https://voxpery.com)** · **[Self-host guide](#production-deployment)** · **[Join community](#community)**

![Voxpery Main UI](docs/images/voxpery02.png)


</div>

---

## Why Voxpery?

| Feature | Voxpery | Discord | Slack | Mattermost |
|---------|---------|---------|-------|-----------|
| **Open Source** | ✅ AGPL-3.0 | ❌ Proprietary | ❌ Proprietary | ✅ |
| **Self-hostable** | ✅ Full | ❌ No | ❌ No | ✅ |
| **Privacy** | ✅ No tracking | ❌ Analytics | ❌ Analytics | ✅ |
| **Voice calling** | ✅ LiveKit SFU | ✅ | ⚠️ Limited | ⚠️ Limited |
| **Lightweight desktop** | ✅ Tauri (50MB) | ❌ Electron (200MB) | ❌ Electron | ❌ Electron |
| **Free forever** | ✅ Yes | ⚠️ Freemium | ❌ Paid | ⚠️ OSS |
| **Source code** | ✅ Public | ❌ Hidden | ❌ Hidden | ✅ Public |

---

## Features

### Communication
- 🎙️ **Crystal-clear voice** — LiveKit SFU, auto quality adaptation, screen sharing
- 💬 **Text & DMs** — Servers, channels, direct messages with real-time typing
- 👥 **Friends & social** — Add friends, see status, mutual presence

### Security & Privacy
- 🔒 **Military-grade auth** — JWT + Argon2, httpOnly cookies (XSS-safe)
- 🛡️ **No tracking** — Zero analytics, zero telemetry, zero ads
- 🏠 **Self-hosted** — Full control of your data, run on your server
- 🔐 **Open source** — Audit-ready code, AGPL license

### Performance
- ⚡ **Lightweight** — 50MB Tauri desktop (vs 200MB Electron)
- 🚀 **Fast deployment** — Docker Compose, one command
- 📦 **Scalable** — PostgreSQL + Redis, horizontal scaling ready



## Stack

| Layer    | Tech |
|----------|------|
| Backend  | Rust, Axum |
| DB       | PostgreSQL |
| Cache    | Redis |
| Voice    | LiveKit SFU |
| Frontend | React 19, TypeScript 5, Vite 7 |
| Auth     | JWT, Argon2; httpOnly cookie |

## Quick Start

### For Users: No Setup Required

**Use the hosted app:** [voxpery.com](https://voxpery.com)
- Sign up → Create/join servers → Start voice
- No credit card, no data collection
- Same open-source code as self-hosted version

### For Self-Hosters: Deploy Your Own

**Easiest:** Start infra with Docker Compose, then run backend + web apps

```bash
git clone https://github.com/emircanagac/voxpery.git
cd voxpery

# Copy and edit environment
cp .env.example .env

# Start infrastructure only (postgres + redis + livekit)
docker compose up -d

# Run backend
cd apps/server && cargo run

# Run frontend (new terminal)
cd apps/web && npm run dev

# Open http://localhost:5173
```

**Need production setup?** → See [**Deployment Guide**](docs/DEPLOYMENT.md)
- Nginx + TLS setup
- systemd backend service
- Backup and operations checklist

**For developers:** See [Contributing Guide](docs/CONTRIBUTING.md)

### Desktop App

```bash
cd apps/desktop
cargo tauri dev
```

---

## Production Deployment

See [**docs/DEPLOYMENT.md**](docs/DEPLOYMENT.md) for complete setup guide covering:

- **Docker Compose** — Infrastructure stack (Postgres, Redis, LiveKit)
- **Host services** — Rust backend as `systemd` service + React static build
- **Nginx + TLS** — Reverse proxy and certificate setup
- **Troubleshooting** — Health checks, backups, monitoring, performance tuning

**TL;DR local setup:**
```bash
docker compose up -d  # Postgres + Redis + LiveKit
cd apps/web && npm run dev
cd apps/server && cargo run
# Open http://localhost:5173
```

---

## Documentation

- **[CONTRIBUTING.md](docs/CONTRIBUTING.md)** — Development setup, workflow, contribution areas
- **[CODE_OF_CONDUCT.md](docs/CODE_OF_CONDUCT.md)** — Community standards, enforcement
- **[ROADMAP.md](docs/ROADMAP.md)** — Feature priorities & roadmap through Q4 2026
- **[PROJECT_OPERATIONS.md](docs/PROJECT_OPERATIONS.md)** — Support, governance, and release workflow
- **[CHANGELOG.md](docs/CHANGELOG.md)** — Notable changes by release
- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — Production deployment guide
- **[docs/](docs/)** — Architecture, voice system, API, database, security, development

---

## Community

- **[→ Join Voxpery Discussions](https://github.com/emircanagac/voxpery/discussions)** — Ask questions, get help, discuss features
- **[→ Report bugs / suggest features](https://github.com/emircanagac/voxpery/issues)**
- **[→ Read docs](docs/)**

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=emircanagac/voxpery&type=Date)](https://star-history.com/#emircanagac/voxpery&Date)

---

## License

[AGPL-3.0](LICENSE) — Free, open-source, forever. Your data is yours.
