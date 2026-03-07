-- Daily digest settings
ALTER TABLE users_config ADD COLUMN digest_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users_config ADD COLUMN digest_time time DEFAULT '08:00';
ALTER TABLE users_config ADD COLUMN digest_timezone text DEFAULT 'UTC';
ALTER TABLE users_config ADD COLUMN digest_project_id text DEFAULT NULL;
ALTER TABLE users_config ADD COLUMN last_digest_at timestamptz DEFAULT NULL;
