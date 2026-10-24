-- Local development bootstrap. Run as a PostgreSQL superuser:
--   psql "$POSTGRES_SUPERUSER_URL" -f scripts/setup-db.sql
-- Creates two roles:
--   vicora_owner : owns the schema, runs migrations, seed and background jobs (bypasses RLS as table owner)
--   vicora_app   : used by web requests; subject to row-level security, cannot bypass it
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vicora_owner') THEN
    CREATE ROLE vicora_owner LOGIN PASSWORD 'vicora_owner_dev_only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vicora_app') THEN
    CREATE ROLE vicora_app LOGIN PASSWORD 'vicora_app_dev_only' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
SELECT 'CREATE DATABASE vicora OWNER vicora_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'vicora')\gexec
SELECT 'CREATE DATABASE vicora_test OWNER vicora_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'vicora_test')\gexec
