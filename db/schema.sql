-- Schema for the bug tracker used by /bug (commands/bug.js) and the pm TUI.
-- Run once against DATABASE_URL: psql "$DATABASE_URL" -f db/schema.sql

CREATE TABLE IF NOT EXISTS bug_reports (
  id                  SERIAL PRIMARY KEY,
  project             TEXT NOT NULL,
  title               TEXT NOT NULL,
  body                TEXT,
  severity            TEXT NOT NULL DEFAULT 'normal',
  status              TEXT NOT NULL DEFAULT 'open',
  reporter            TEXT,
  discord_channel_id  TEXT,
  discord_message_id  TEXT,
  discord_thread_id   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keeps updated_at current and notifies listeners (lib/db.js's startBugListener)
-- so Discord threads stay in sync whenever status changes from /bug or the pm TUI.
CREATE OR REPLACE FUNCTION notify_bug_status_changed() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM pg_notify('bug_status_changed', json_build_object(
      'id', NEW.id,
      'status', NEW.status,
      'project', NEW.project,
      'discord_channel_id', NEW.discord_channel_id,
      'discord_message_id', NEW.discord_message_id,
      'discord_thread_id', NEW.discord_thread_id
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bug_status_notify ON bug_reports;
CREATE TRIGGER bug_status_notify
  BEFORE UPDATE ON bug_reports
  FOR EACH ROW
  EXECUTE FUNCTION notify_bug_status_changed();
