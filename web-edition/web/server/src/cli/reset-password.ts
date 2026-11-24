// Manual password reset by an admin. Users normally reset their own password by email (POST /auth/forgot-password);
// this stays for when email is off or not reaching someone.
//
//   printf '%s\n' 'new-password' | docker exec -i <noteriv-api> node dist/cli/reset-password.js user@example.com
//
// The password is read from stdin (first line) so it never lands in argv, `ps` or shell history.
// All of the user's refresh tokens are revoked, so every device must sign in again once the (15 minute)
// access token expires. The action is written to the audit log. Verify who is asking BEFORE running this.
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/password.js";

// Stored in lower case since session 5.2 (routes/auth.ts emailField).
const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("usage: node dist/cli/reset-password.js <email>   (new password on stdin)");
  process.exit(2);
}

async function readFirstLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
}

const password = await readFirstLine();
// Same bounds as registration (routes/auth.ts registerSchema).
if (password.length < 8 || password.length > 200) {
  console.error("password must be 8-200 characters (read from the first line of stdin)");
  process.exit(2);
}

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error("no user with that email");
    process.exit(1);
  }
  const passwordHash = await hashPassword(password);
  const [, revoked] = await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    // Awaited on purpose: unlike routes/auth.ts this process exits right after, so a fire-and-forget log could be lost.
    prisma.auditLog.create({ data: { userId: user.id, action: "password_reset_manual", resourceType: "user", resourceId: user.id } }),
  ]);
  console.log(`OK: password reset for ${user.email}; ${revoked.count} session(s) revoked`);
} finally {
  await prisma.$disconnect();
}
