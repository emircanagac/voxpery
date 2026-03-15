# Release Smoke Test Checklist

Use this checklist for every production release candidate before tag/publish.

## Release Candidate Info

- Version:
- Commit SHA:
- Tester:
- Date (UTC):
- Environment:

## 1) Automated Gates (must be green)

- [ ] `CI / Backend`
- [ ] `CI / Frontend`
- [ ] `Secret Scan (gitleaks)`
- [ ] `Dependency Security Audit`

## 2) Web Smoke Tests (mandatory)

- [ ] Register works.
- [ ] Login works.
- [ ] Password reset request + reset flow works.
- [ ] Google OAuth login works.
- [ ] Server/channel/category permission scenarios work.
- [ ] Voice join/leave works.
- [ ] Moderation flows (kick/ban) work.
- [ ] Category overrides work for `View Channel`, `Send Messages`, `Connect to Voice`.

## 3) Desktop Smoke Tests (mandatory)

- [ ] Installer opens with Voxpery app name and icon (not default NSIS icon).
- [ ] App opens and reaches login screen.
- [ ] Google OAuth opens browser and returns to desktop app via `voxpery://` deep link.
- [ ] Session is restored after OAuth callback (user ends in authenticated app state).
- [ ] If updater artifacts are enabled, signing keys and updater pubkey are configured (see `docs/DESKTOP_RELEASE_HARDENING.md`).
- [ ] First voice join shows OS/browser microphone permission prompt when needed.
- [ ] Voice join succeeds after permission grant.
- [ ] Voice join deny/error UX is understandable (no broken or stuck state).

## 4) Final Sign-off

- [ ] Changelog updated (`docs/CHANGELOG.md`).
- [ ] Deployment notes updated if needed (`docs/DEPLOYMENT.md`).
- [ ] Release notes draft prepared.
- [ ] Approved to tag and publish.

## Sign-off

- QA / Maintainer:
- Final decision: `GO` / `NO-GO`
- Notes:
