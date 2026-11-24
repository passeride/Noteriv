-- Per-user LLM provider API keys. key_encrypted holds "enc:<fernet token>" (lib/credentials-vault.ts), never the key.
CREATE TABLE "llm_api_keys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "key_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "llm_api_keys_user_id_provider_key" ON "llm_api_keys"("user_id", "provider");

ALTER TABLE "llm_api_keys" ADD CONSTRAINT "llm_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
