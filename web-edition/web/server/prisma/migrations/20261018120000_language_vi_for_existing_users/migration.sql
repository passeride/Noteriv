-- Stage 4, session 4.5: the web app now follows the browser's language (English when it is neither English nor
-- Vietnamese). Accounts created before this change saw Vietnamese; they keep it unless they pick another language in
-- Settings. Data only (no schema change), so it can be applied before the new code is deployed. Re-running it is
-- harmless: it only fills a language where none is set.

-- Accounts with preferences but no language yet.
UPDATE "user_preferences"
SET "editor_settings" = jsonb_set("editor_settings", '{language}', '"vi"'),
    "updated_at" = CURRENT_TIMESTAMP
WHERE NOT ("editor_settings" ? 'language');

-- Accounts that never saved preferences.
INSERT INTO "user_preferences" ("id", "user_id", "hotkeys", "editor_settings", "updated_at")
SELECT gen_random_uuid()::text, u."id", '{}'::jsonb, '{"language":"vi"}'::jsonb, CURRENT_TIMESTAMP
FROM "users" u
WHERE NOT EXISTS (SELECT 1 FROM "user_preferences" p WHERE p."user_id" = u."id");
