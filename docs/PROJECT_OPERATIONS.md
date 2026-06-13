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

Roadmap priorities are tracked in [ROADMAP.md](ROADMAP.md). Maintainers keep the roadmap aligned with the product direction: open-source community chat and voice with hosted access, self-hosting, and user data ownership.

Roadmap changes should:

- Prefer reliability, safety, onboarding, daily UX, and self-hosting improvements over speculative expansion.
- Promote issues that block releases, registration, desktop voice, moderation, or production operation.
- Keep completed work reflected in docs so contributors do not plan around stale milestones.
- Split large product areas into focused issues before implementation starts.

## Release Process

### Versioning

Voxpery follows Semantic Versioning:

- **MAJOR**: breaking API/protocol/behavior changes
- **MINOR**: backward-compatible features
- **PATCH**: backward-compatible fixes

### Quality Gate Tiers

- **Required PR gates**: `Checks / Secret Scan`, `Checks / Backend`, and `Checks / Frontend`. Keep these fast and deterministic so branch protection can require them on every PR.
- **Security monitoring gates**: CodeQL and dependency security audit workflows run on PRs, schedules, or manually. Review their output before release; an upstream-blocked advisory needs an explicit release decision rather than being silently ignored.
- **Release smoke gates**: release metadata sync runs automatically before Docker publishing on `v*` tag builds. The manual `Release / Smoke` workflow can be run against release candidate API and web URLs for post-deploy confidence; it verifies public health endpoints, immutable image-tag format, and the deployed web version tag.
- **Publish jobs**: Docker publish, tag release, desktop release, and manual smoke jobs must not be configured as required PR checks because they are intentionally skipped or manually triggered on PRs. Docker publish runs automatically for `v*` tag pushes; the manual deploy workflow builds and publishes immutable `sha-<commit>` images before deploying a `main-candidate`. Docker publish jobs must produce immutable `sha-<commit>` tags for manually deployed main-candidate builds and version tags for `v*` releases; production deploys must resolve to an exact image tag rather than Docker `latest`.

### Release Checklist

1. Prepare the candidate from updated `main` and keep the final release commit SHA recorded.
2. Update docs for behavior changes and update the changelog entry before creating the tag.
3. Keep all version-bearing artifacts in sync in the same change: web `package.json` and `package-lock.json`, server `Cargo.toml` and `Cargo.lock` when present, desktop `Cargo.toml`, `Cargo.lock`, `tauri.conf.json`, release/checklist docs that name the version, Docker image tags, the web top-bar version badge, desktop app version, and updater metadata.
4. Ensure required PR gates are green on the release branch and no security monitoring gate is ignored without a recorded decision.
5. Run the manual `Release / Smoke` workflow against the release candidate API and record the workflow run URL in [RELEASE_SMOKE_TEST_CHECKLIST.md](RELEASE_SMOKE_TEST_CHECKLIST.md).
6. Complete and sign off [RELEASE_SMOKE_TEST_CHECKLIST.md](RELEASE_SMOKE_TEST_CHECKLIST.md) (required).
7. Validate [DESKTOP_RELEASE_HARDENING.md](DESKTOP_RELEASE_HARDENING.md) if desktop artifacts are part of the release.
8. Validate critical paths: auth, messaging+websocket, voice join/leave.
9. Create and push the Git tag (for example `v0.1.5`) from the exact signed-off commit.
10. Confirm tag-triggered release jobs, Docker publish jobs, and desktop artifact jobs ran against that exact tag/ref.
11. Record the exact Docker image tag selected for production deploy and verify the manual deploy workflow used that tag.
12. Verify release assets and updater metadata before publishing or announcing the release.
13. Publish GitHub Release notes only after artifacts, signatures, and smoke sign-off are complete.

### Release Workflow Rules

- Prefer tag-driven releases: push the `v*` tag from the signed-off commit and let tag-triggered CI/release jobs build the immutable candidate.
- Release Docker images are tagged with both `vX.Y.Z` and `sha-<commit>`. Manually deployed main-candidate Docker images are commit-tagged as `sha-<commit>`. The web image embeds the selected deploy tag in the top-bar version badge. Do not rely on `latest` for production deploys.
- Manual production deploys should use the default `latest-release` channel for normal stable releases, `main-candidate` for one-click pre-release build-and-deploy verification, and `custom` only for explicit rollback or advanced operations. Each channel resolves to a concrete image tag before deploying.
- If a GitHub Release is created manually and workflows do not run, do not announce it as ready. Run the appropriate manual workflow against the exact tag/ref or recreate the tag/release intentionally.
- Manual desktop release workflow runs must use the exact release tag/ref, set `smoke_checklist_confirmed=yes`, and use `platform=all` for production releases unless the release is explicitly a single-platform hotfix/test.
- Keep the release draft until `latest.json`, installer assets, signature files, and release notes all point to the same version and tag.
- Record the workflow run URLs and GO/NO-GO decision in the release checklist so rollback and audit history are clear.

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
