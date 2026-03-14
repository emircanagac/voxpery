# Contributing to Voxpery

Thank you for your interest in contributing to Voxpery! We welcome contributions from everyone.

## Getting Started

### Prerequisites
- Rust 1.75+ (backend)
- Node.js 20+ (frontend)
- Docker (postgres + redis + livekit)

### Local Development Setup

```bash
# Clone the repository
git clone https://github.com/emircanagac/voxpery.git
cd voxpery

# Create local env
cp .env.example .env

# Start infrastructure (postgres + redis + livekit)
docker compose up -d

# Backend setup
cd apps/server
cargo build

# Frontend setup
cd ../web
npm install

# Run backend
cd ../server && cargo run

# Run frontend (in another terminal)
cd apps/web
npm run dev
```

## Development Workflow

### Code Style
- **Rust:** Follow `cargo fmt` and `cargo clippy`
- **TypeScript/React:** Follow ESLint config (`eslint.config.js`)
- **Commit messages:** Use conventional commits (`feat:`, `fix:`, `docs:`, `test:`, etc.)

### Before Submitting a PR
1. Run tests locally
   ```bash
   # Frontend
   npm run test:run
   npm run build

   # Backend
   cargo test --lib
   ```

2. Format code
   ```bash
   cargo fmt
   npx eslint . --fix
   ```

3. Update documentation if changing functionality

### Documentation Sync (Required)

If your PR changes behavior in auth/permissions/channels/database, update docs in the same PR:

- `docs/API.md` for endpoint/contract changes
- `docs/DATABASE.md` for schema/migration changes
- `docs/SECURITY.md` for auth/permission/security behavior changes

This prevents documentation drift on fast-moving features.

### Git Workflow
1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit changes: `git commit -m "feat: description"`
4. Push to fork: `git push origin feat/your-feature`
5. Open a Pull Request

## Areas We Need Help

### High Priority
- [ ] Voice/WebRTC tests (currently 0% coverage)
- [ ] Desktop auto-updater implementation
- [ ] Horizontal scaling guide
- [ ] Multi-language support (i18n)

### Medium Priority
- [ ] PWA support (service worker)
- [ ] Message editing & deletion
- [ ] Mobile UI/UX polish
- [ ] Mobile app (React Native)

### Low Priority
- [ ] Theme customization
- [ ] Emoji reactions
- [ ] Message search
- [ ] Analytics dashboard

## Reporting Bugs

Use the [Bug Report](../.github/ISSUE_TEMPLATE/bug.md) template. Include:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots (if relevant)
- Environment info

## Proposing Features

Use the [Feature Request](../.github/ISSUE_TEMPLATE/feature.md) template. Include:
- Problem statement
- Proposed solution
- Alternative approaches
- Impact assessment

## Code Review Process

All PRs require:
1. Passing CI/CD tests
2. At least 1 approval from maintainers
3. Updated documentation (if needed)
4. No merge conflicts

## Community Guidelines

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for our community standards.

## Questions?

- Open a [Discussion](https://github.com/emircanagac/voxpery/discussions)
- Check [README.md](README.md) in this folder for the docs index

---

Thank you for making Voxpery better! 🎉
