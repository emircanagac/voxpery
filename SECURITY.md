# Security Policy

## Supported Versions

Voxpery is currently maintained on the latest public release line and on `main`.

| Version | Supported |
| ------- | --------- |
| Latest release | Yes |
| `main` | Yes |
| Older releases | No |

## Reporting a Vulnerability

If you find a security issue, please do **not** open a public issue.

Use one of these private reporting paths instead:

- GitHub Security Advisories / private vulnerability reporting:
  `https://github.com/emircanagac/voxpery/security/advisories/new`
- Email: `voxpery@gmail.com`

Please include:

- A short description of the issue
- Reproduction steps or a proof of concept
- Affected surface (`web`, `desktop`, `server`, `docker`, etc.)
- Potential impact

## Response Expectations

Reports will be reviewed and triaged as quickly as possible. Valid reports will
be handled privately until a fix is ready. Please allow reasonable time for a
patch before public disclosure.

## Security Highlights

- Web auth uses `httpOnly` cookies in production
- Desktop auth uses OS-native secure storage
- Secrets are environment-based and not meant to be committed
- CORS wildcard configuration is rejected at startup
- Attachments use scoped access and viewer authorization
- Optional ClamAV scanning is supported for uploads
- Dependency scanning runs in CI

## Additional Documentation

For the detailed technical security reference, see
[docs/SECURITY.md](docs/SECURITY.md).
