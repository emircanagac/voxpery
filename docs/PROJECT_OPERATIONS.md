# Project Operations

This document combines support flow, governance rules, and release process for Voxpery.

## Support

### Where to Ask What

- **Usage help / how-to questions**: [GitHub Discussions](https://github.com/emircanagac/voxpery/discussions)
- **Bug reports**: [GitHub Issues](https://github.com/emircanagac/voxpery/issues) using the bug template
- **Feature requests**: [GitHub Issues](https://github.com/emircanagac/voxpery/issues) using the feature template
- **Security vulnerabilities**: follow [SECURITY.md](SECURITY.md) responsible disclosure guidance

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

### Release Checklist

1. Ensure CI is green on release branch/tag.
2. Validate critical paths: auth, messaging+websocket, voice join/leave.
3. Update docs for behavior changes.
4. Update changelog entry.
5. Create Git tag (for example `v1.4.0`).
6. Publish GitHub Release notes.

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
