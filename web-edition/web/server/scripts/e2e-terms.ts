// Puts an end-to-end test account back on an older version of the Terms, so the app asks it to accept again
// (e2e/tests/legal.spec.ts). Run: npx tsx scripts/e2e-terms.ts <email>. Never run against production.

import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";

if (existsSync(".env") && !process.env.DATABASE_URL) process.loadEnvFile(".env");

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("usage: npx tsx scripts/e2e-terms.ts <email>");
  process.exit(2);
}

const prisma = new PrismaClient();
await prisma.user.update({ where: { email }, data: { termsVersion: "2026-10-15" } });
await prisma.$disconnect();
console.log("terms reset");
