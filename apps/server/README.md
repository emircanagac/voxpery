# Voxpery Server

Privacy-first communication server (Rust, Axum, PostgreSQL).

## Running tests

- **Unit tests** (no DB): `cargo test --lib`
- **Integration tests** (require PostgreSQL): set `DATABASE_URL` and optionally `JWT_SECRET` (defaults to a test value), then run:
  - `cargo test --test integration`

If `DATABASE_URL` is not set, integration tests skip (they exit early with a message). Use a dedicated test database so tests do not touch production data.
