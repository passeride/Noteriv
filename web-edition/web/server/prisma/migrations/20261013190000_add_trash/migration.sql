-- AlterTable
ALTER TABLE "notes" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "folders" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "notes_vault_id_deleted_at_idx" ON "notes"("vault_id", "deleted_at");
CREATE INDEX "folders_vault_id_deleted_at_idx" ON "folders"("vault_id", "deleted_at");
