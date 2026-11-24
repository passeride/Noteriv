-- NOTE: Prisma's migration diff tool doesn't understand the `content_tsv`
-- generated column (Unsupported("tsvector") in schema.prisma) and proposes
-- dropping its index/default on every subsequent migration — removed by hand.
-- See prisma/migrations/20261012071108_add_backlinks_and_search for the real column def.

-- CreateTable
CREATE TABLE "plugins" (
    "id" TEXT NOT NULL,
    "vault_id" TEXT NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "main_js" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plugins_vault_id_plugin_id_key" ON "plugins"("vault_id", "plugin_id");

-- AddForeignKey
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
