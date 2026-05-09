# Project Operations

This document combines support flow, governance rules, and release process for Voxpery.

## Support

### Where to Ask What

- **Usage help / how-to questions**: [GitHub Discussions](https://github.com/emircanagac/voxpery/discussions)
- **Bug reports**: [GitHub Issues](https://github.com/emircanagac/voxpery/issues) using the bug template
- **Feature requests**: [GitHub Issues](https://github.com/emircanagac/voxpery/issues) using the feature template
- **Security vulnerabilities**: follow [../SECURITY.md](../SECURITY.md) responsible disclosure guidance

### Before Opening an Issue

- Check existing issues and discussions
- Include steps to reproduce and expected vs actual behavior
- Include environment details (OS, browser/desktop, logs)

## Governance

### Roles

- **Maintainers**: review/merge PRs, maintain roadmap quality, enforce community standards
- **Contributors**: propose changes via Issues/Discussions/PRs and improve code/docs/tests

### Decision Process

1. Proposals start in Discussions or Issues.
2. Maintainers evaluate changes by user impact, security/privacy impact, maintenance cost, and roadmap fit.
3. PRs merge after CI passes and at least one maintainer approval.

### Conflict Resolution

- Use respectful, evidence-based discussion.
- If consensus is not reached, maintainers make the final call.
- Conduct rules follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

### Roadmap Ownership

Roadmap priorities are tracked in [ROADMAP.md](ROADMAP.md) and updated based on community feedback and maintainer capacity.

## Release Process

### Versioning

Voxpery follows Semantic Versioning:

- **MAJOR**: breaking API/protocol/behavior changes
- **MINOR**: backward-compatible features
- **PATCH**: backward-compatible fixes

### Quality Gate Tiers

- **Required PR gates**: `Checks / Secret Scan`, `Checks / Backend`, and `Checks / Frontend`. Keep these fast and deterministic so branch protection can require them on every PR.
- **Security monitoring gates**: CodeQL and dependency security audit workflows run on PRs, schedules, or manually. Review their output before release; an upstream-blocked advisory needs an explicit release decision rather than being silently ignored.
- **Release smoke gates**: run the manual `Release Smoke` workflow against the release candidate API before tagging or publishing. Use strict security headers for production candidates and enable browser E2E only when the candidate environment is ready for it.
- **Publish jobs**: Docker publish, tag release, desktop release, and manual smoke jobs must not be configured as required PR checks because they are intentionally skipped or manually triggered on PRs.

### Release Checklist

1. Ensure required PR gates are green on the release branch/tag.
2. Run the manual `Release Smoke` workflow against the release candidate API.
3. Complete and sign off [RELEASE_SMOKE_TEST_CHECKLIST.md](RELEASE_SMOKE_TEST_CHECKLIST.md) (required).
4. Validate [DESKTOP_RELEASE_HARDENING.md](DESKTOP_RELEASE_HARDENING.md) if desktop artifacts are part of release.
5. Validate critical paths: auth, messaging+websocket, voice join/leave.
6. Update docs for behavior changes.
7. Update changelog entry.
8. Create Git tag (for example `v0.1.5`).
9. Publish GitHub Release notes.

### Changelog Sections

- Added
- Changed
- Fixed
- Security

### Hotfixes

- Branch from latest stable tag
- Apply minimal fix
- Run targeted tests
- Release as PATCH version

### Rollback

1. Roll back to previous stable release/tag.
2. Open incident issue with timeline and impact.
3. Ship follow-up fix with test coverage.
