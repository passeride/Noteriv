-- CreateTable
CREATE TABLE "user_vault_states" (
    "id" TEXT NOT NULL,
    "vault_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "open_tabs" JSONB NOT NULL DEFAULT '[]',
    "active_tab_id" TEXT,
    "pinned_tab_ids" JSONB NOT NULL DEFAULT '[]',
    "file_view_modes" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_vault_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_vault_states_vault_id_user_id_key" ON "user_vault_states"("vault_id", "user_id");

-- AddForeignKey
ALTER TABLE "user_vault_states" ADD CONSTRAINT "user_vault_states_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_vault_states" ADD CONSTRAINT "user_vault_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
