// Ensures the invite code used by the end-to-end tests (e2e/) exists and is usable.
// Run: npx tsx scripts/e2e-invite.ts [CODE] — prints the code. Never run against production.

import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";

if (existsSync(".env") && !process.env.DATABASE_URL) process.loadEnvFile(".env");

const code = (process.argv[2] ?? process.env.E2E_INVITE_CODE ?? "E2EINVITE").replace(/[\s-]+/g, "").toUpperCase();
const prisma = new PrismaClient();

await prisma.inviteCode.upsert({
  where: { code },
  update: { revokedAt: null, expiresAt: null, maxUses: 1_000_000 },
  create: { code, note: "end-to-end tests", maxUses: 1_000_000 },
});
await prisma.$disconnect();
console.log(code);
