# Security Policy

## Supported Versions

Voxpery is currently in early public release. Security fixes are applied to the
latest supported release line and to `main`.

| Version | Supported |
| ------- | --------- |
| Latest release | Yes |
| `main` | Yes |
| Older releases | No |

## Reporting a Vulnerability

If you find a security issue, please do not open a public issue.

Use one of these private reporting paths instead:

- GitHub Security Advisories / private vulnerability reporting
- Email: voxpery@gmail.com

Please include:

- A short description of the issue
- Reproduction steps or proof of concept
- Affected deployment surface (`web`, `desktop`, `server`, `docker`, etc.)
- Potential impact

## Response Expectations

We will review and triage reports as quickly as possible. Valid reports will be
handled privately until a fix is ready. Please allow reasonable time for a
patch before public disclosure.

## Security Highlights

- Web auth uses httpOnly cookies in production
- Desktop auth uses OS-native secure storage
- JWT secrets, OAuth secrets, and infrastructure secrets are environment-based
- CORS wildcard configuration is rejected at startup
- Attachments use signed URLs plus viewer authorization
- Optional ClamAV scanning is supported for uploads
- Dependency scanning runs in CI

## Hardening Checklist

- Rotate all production secrets before first public deployment
- Keep `COOKIE_SECURE=1` for HTTPS deployments
- Expose only required ports through the reverse proxy and firewall
- Keep database and Redis bound privately
- Review CI and deploy secrets regularly

For the full technical security reference, see
[docs/SECURITY.md](../docs/SECURITY.md).
