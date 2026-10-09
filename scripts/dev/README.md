# Local Development Tools

Reusable development helpers, not deployed application services. Run commands
from the repository root with Node.js >= 24 and a local development `.env`.
See [Development](../../docs/DEVELOPMENT.md) for supporting Docker services.

Run `node scripts/dev/local-qa.mjs <command>`:

- `init`: validate local configuration without printing credentials.
- `backend`: run the server.
- `backend-test`: use a separate test database and Redis index.
- `frontend`: start Vite on loopback.
- `desktop`: run the normal Tauri desktop development configuration.

`local-qa-config.mjs` validates and normalizes loopback service URLs.
Platform packaging recipes stay within the component they build.

Run helper regressions with:

```sh
node --test scripts/dev/*.test.mjs scripts/tests/*.test.mjs
```

Keep private environments, credentials, generated artifacts and test transcripts
out of Git. Only reusable sources and regression tests belong here.
