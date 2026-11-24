-- CreateTable
CREATE TABLE "note_snapshots" (
    "id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "note_snapshots_note_id_created_at_idx" ON "note_snapshots"("note_id", "created_at");

-- AddForeignKey
ALTER TABLE "note_snapshots" ADD CONSTRAINT "note_snapshots_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
