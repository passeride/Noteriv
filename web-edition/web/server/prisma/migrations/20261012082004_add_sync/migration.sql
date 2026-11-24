-- CreateEnum
CREATE TYPE "SyncProviderType" AS ENUM ('github', 'gitlab', 'gitea', 'forgejo', 'webdav');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('push', 'pull', 'both');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('queued', 'running', 'success', 'conflict', 'error');

-- NOTE: same spurious content_tsv drift Prisma proposes every time (see the
-- add_plugins migration's comment) — removed by hand again.

-- CreateTable
CREATE TABLE "sync_connections" (
    "id" TEXT NOT NULL,
    "vault_id" TEXT NOT NULL,
    "provider_type" "SyncProviderType" NOT NULL,
    "remote_url" TEXT,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "auth_username" TEXT,
    "webdav_url" TEXT,
    "webdav_path" TEXT,
    "credentials_encrypted" BYTEA NOT NULL,
    "direction" "SyncDirection" NOT NULL DEFAULT 'both',
    "auto_sync" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMP(3),
    "last_sync_status" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "sync_connection_id" TEXT NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'queued',
    "pushed_count" INTEGER NOT NULL DEFAULT 0,
    "pulled_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_jobs_sync_connection_id_idx" ON "sync_jobs"("sync_connection_id");

-- AddForeignKey
ALTER TABLE "sync_connections" ADD CONSTRAINT "sync_connections_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_sync_connection_id_fkey" FOREIGN KEY ("sync_connection_id") REFERENCES "sync_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
