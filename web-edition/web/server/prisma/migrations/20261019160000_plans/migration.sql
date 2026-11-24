-- Stage 5, session 5.3: plans and limits (lib/plans.ts). Adds a column to "users" that every query reads, so in
-- production apply this BEFORE deploying the new code (docs/ops/trien-khai.md section 7).

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "max_vaults" INTEGER,
    "max_attachment_bytes" BIGINT,
    "max_sync_connections" INTEGER,
    "max_snapshots_per_note" INTEGER,
    "max_collaborators_per_vault" INTEGER,
    "ai_requests_per_month" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- The two starting plans (owner's choice, 2026-10-19). Change numbers with cli/plan.ts, not here.
-- free: 10 vaults, 1 GiB of attachments per account, 3 sync connections, 50 history versions per note.
-- unlimited: no limits, except 200 history versions per note so the snapshot table cannot grow forever.
INSERT INTO "plans" ("id", "name", "max_vaults", "max_attachment_bytes", "max_sync_connections", "max_snapshots_per_note")
VALUES ('free', 'Free', 10, 1073741824, 3, 50),
       ('unlimited', 'Unlimited', NULL, NULL, NULL, 200);

-- AlterTable
ALTER TABLE "users" ADD COLUMN "plan_id" TEXT NOT NULL DEFAULT 'free';

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
