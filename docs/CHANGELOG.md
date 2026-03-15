# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- PR template for contribution quality and security checks.
- Dependabot configuration for GitHub Actions, Rust, and web dependencies.
- Release smoke checklist doc for mandatory web + desktop release sign-off.
- GDPR/KVKK self-service endpoints:
  - `GET /api/auth/data-export`
  - `DELETE /api/auth/account` (permanent delete)
- Account settings actions for exporting user data and account deletion flow.
- Desktop hardening policy doc: `docs/DESKTOP_RELEASE_HARDENING.md`.

### Changed
- Documentation sync guidance strengthened to reduce permission/schema drift.
- Desktop release workflow now runs preflight metadata/icon validation and requires checklist confirmation on manual release runs.
- Desktop preflight now enforces updater signing prerequisites when updater artifacts are enabled.
- Security doc compliance section updated with GDPR/KVKK implementation status.

## [0.1.0] - 2026-03-14

### Added
- Initial public open-source release structure.
