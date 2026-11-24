// Puts an end-to-end test account on a tiny plan so the tests can reach every limit quickly, and marks its email
// verified (the unverified-account limits of lib/emailGate.ts are tested elsewhere).
// Run: npx tsx scripts/e2e-plan.ts <email>. Never run against production.

import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";

if (existsSync(".env") && !process.env.DATABASE_URL) process.loadEnvFile(".env");

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("usage: npx tsx scripts/e2e-plan.ts <email>");
  process.exit(2);
}

const PLAN = { id: "e2e-tight", name: "E2E tight", maxVaults: 2, maxAttachmentBytes: 1000n, maxSyncConnections: 0, maxSnapshotsPerNote: 3 };

const prisma = new PrismaClient();
await prisma.plan.upsert({ where: { id: PLAN.id }, update: PLAN, create: PLAN });
await prisma.user.update({ where: { email }, data: { planId: PLAN.id, emailVerifiedAt: new Date() } });
await prisma.$disconnect();
console.log(PLAN.id);
