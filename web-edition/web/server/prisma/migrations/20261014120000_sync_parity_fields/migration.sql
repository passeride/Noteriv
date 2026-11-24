-- AlterTable
ALTER TABLE "sync_connections"
  ADD COLUMN "sync_interval_minutes" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "commit_template" TEXT NOT NULL DEFAULT 'Sync notes {date}',
  ADD COLUMN "sync_on_save" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pull_on_open" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "account_login" TEXT,
  ADD COLUMN "account_avatar_url" TEXT;

-- AlterTable
ALTER TABLE "sync_jobs" ADD COLUMN "conflict_files" JSONB;
