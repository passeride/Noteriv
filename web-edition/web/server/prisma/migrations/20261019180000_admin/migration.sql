-- Stage 5, session 5.4: admin role in the database, account locking, audit log paging.
-- Adds columns to "users" that every query reads, so in production apply this BEFORE deploying the new code
-- (docs/ops/trien-khai.md section 7). Emails in ADMIN_EMAILS stay admins without this column.

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'user',
ADD COLUMN "locked_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
