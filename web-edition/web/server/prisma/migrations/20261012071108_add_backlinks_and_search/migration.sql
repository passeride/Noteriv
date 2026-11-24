-- CreateEnum
CREATE TYPE "LinkType" AS ENUM ('wikilink', 'embed');

-- AlterTable
-- Generated column maintained by Postgres on every INSERT/UPDATE of name/content — the app never writes to it.
ALTER TABLE "notes" ADD COLUMN "content_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("content", ''))) STORED;

CREATE INDEX "notes_content_tsv_idx" ON "notes" USING GIN ("content_tsv");

-- CreateTable
CREATE TABLE "backlinks" (
    "id" TEXT NOT NULL,
    "vault_id" TEXT NOT NULL,
    "source_note_id" TEXT NOT NULL,
    "target_note_id" TEXT NOT NULL,
    "link_type" "LinkType" NOT NULL DEFAULT 'wikilink',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backlinks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backlinks_target_note_id_idx" ON "backlinks"("target_note_id");

-- CreateIndex
CREATE UNIQUE INDEX "backlinks_source_note_id_target_note_id_link_type_key" ON "backlinks"("source_note_id", "target_note_id", "link_type");

-- AddForeignKey
ALTER TABLE "backlinks" ADD CONSTRAINT "backlinks_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backlinks" ADD CONSTRAINT "backlinks_source_note_id_fkey" FOREIGN KEY ("source_note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backlinks" ADD CONSTRAINT "backlinks_target_note_id_fkey" FOREIGN KEY ("target_note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
