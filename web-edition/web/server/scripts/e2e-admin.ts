// Gives an end-to-end test account the admin role (and a verified email), for e2e/tests/admin.spec.ts.
// Run: npx tsx scripts/e2e-admin.ts <email>. Never run against production.

import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";

if (existsSync(".env") && !process.env.DATABASE_URL) process.loadEnvFile(".env");

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("usage: npx tsx scripts/e2e-admin.ts <email>");
  process.exit(2);
}

const prisma = new PrismaClient();
await prisma.user.update({ where: { email }, data: { role: "admin", emailVerifiedAt: new Date() } });
await prisma.$disconnect();
console.log("admin");
