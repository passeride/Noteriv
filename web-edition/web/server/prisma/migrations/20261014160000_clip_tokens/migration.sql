-- CreateTable
CREATE TABLE "clip_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "vault_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_hint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "clip_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clip_tokens_token_hash_key" ON "clip_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "clip_tokens_user_id_idx" ON "clip_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "clip_tokens" ADD CONSTRAINT "clip_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clip_tokens" ADD CONSTRAINT "clip_tokens_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
