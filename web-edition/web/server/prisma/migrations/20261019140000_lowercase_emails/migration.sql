-- Stage 5, session 5.2: emails are stored and matched in lower case (lib/registration.ts emailField).
-- Data only. Apply BEFORE deploying the new code: it lower-cases what users type before looking them up, so an
-- address still stored with capitals could not sign in. If two accounts differ only by case, the unique index stops
-- this UPDATE and the whole transaction rolls back: resolve those accounts by hand first.

UPDATE "users" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));

UPDATE "email_tokens" SET "new_email" = lower(btrim("new_email"))
WHERE "new_email" IS NOT NULL AND "new_email" <> lower(btrim("new_email"));
