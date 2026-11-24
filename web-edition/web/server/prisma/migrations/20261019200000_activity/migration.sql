-- Stage 5, session 5.5: one row per user per day of activity, for the admin usage stats.
-- Only adds a table; the old code ignores it, so it is safe to apply before deploying.

-- CreateTable
CREATE TABLE "user_activity_days" (
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "user_activity_days_pkey" PRIMARY KEY ("user_id","day")
);

-- CreateIndex
CREATE INDEX "user_activity_days_day_idx" ON "user_activity_days"("day");

-- AddForeignKey
ALTER TABLE "user_activity_days" ADD CONSTRAINT "user_activity_days_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every day on which an account started a session (sign-in, sign-up or refresh) that is still on record
-- (timestamps are stored in UTC without a time zone, so the cast gives the UTC day).
INSERT INTO "user_activity_days" ("user_id", "day")
SELECT DISTINCT "user_id", "created_at"::date FROM "refresh_tokens"
ON CONFLICT DO NOTHING;
