#!/bin/sh
# Creates or updates the PostgreSQL role the Voxpery server connects with. The role is not a
# superuser: it can connect, create objects in its own database and owns the application
# tables so migrations keep working. Runs as the bootstrap superuser from the
# `postgres-app-role` Compose service before every server start; safe to repeat. On an
# existing installation it moves table ownership from the superuser to the new role.
set -eu

: "${PGUSER:?POSTGRES_USER is required}"
: "${APP_DB_USER:?POSTGRES_APP_USER is required}"
: "${APP_DB_PASSWORD:?POSTGRES_APP_PASSWORD must be set in .env}"

has_placeholder() {
  printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | grep -q 'CHANGE_ME'
}

if [ "$APP_DB_USER" = "$PGUSER" ]; then
  echo "POSTGRES_APP_USER must differ from POSTGRES_USER: the server must not connect as the superuser." >&2
  exit 1
fi
if has_placeholder "$APP_DB_PASSWORD" || [ "${#APP_DB_PASSWORD}" -lt 16 ]; then
  echo "POSTGRES_APP_PASSWORD still has the .env.example placeholder or is shorter than 16 characters. Generate one with 'openssl rand -hex 32'." >&2
  exit 1
fi
if has_placeholder "${PGPASSWORD:-}"; then
  echo "Warning: POSTGRES_PASSWORD still has the .env.example placeholder; see docs/DEPLOYMENT.md." >&2
fi

psql -v ON_ERROR_STOP=1 -q <<'SQL'
\getenv app_user APP_DB_USER
\getenv app_password APP_DB_PASSWORD

SELECT format('CREATE ROLE %I', :'app_user')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec

-- The password is applied on every start, so changing POSTGRES_APP_PASSWORD needs only a restart.
SELECT format(
  'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'app_user', :'app_password'
) \gexec

-- CREATE on the database lets migrations install trusted extensions such as uuid-ossp.
SELECT format('GRANT CONNECT, CREATE, TEMPORARY ON DATABASE %I TO %I', current_database(), :'app_user') \gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'app_user') \gexec

-- Tables first: sequences owned by a column follow their table.
SELECT format('ALTER TABLE public.%I OWNER TO %I', c.relname, :'app_user')
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind IN ('r', 'p')
  AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = :'app_user')
  AND NOT EXISTS (
    SELECT FROM pg_depend d
    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
  ) \gexec

SELECT format('ALTER SEQUENCE public.%I OWNER TO %I', c.relname, :'app_user')
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind = 'S'
  AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = :'app_user')
  AND NOT EXISTS (
    SELECT FROM pg_depend d
    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i', 'e')
  ) \gexec
SQL

echo "Database role '$APP_DB_USER' is ready."
