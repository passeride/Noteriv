// Plans and their limits (lib/plans.ts), for the operator until the admin page (session 5.4) does this on screen.
//
//   docker exec <noteriv-api> node dist/cli/plan.js list
//   docker exec <noteriv-api> node dist/cli/plan.js assign user@example.com unlimited
//   docker exec <noteriv-api> node dist/cli/plan.js set free maxVaults 20        (or: unlimited)
//   docker exec <noteriv-api> node dist/cli/plan.js create team "Team"
//
// Changes take effect on the next request (plans are not in the sign-in token). Each change is written to the audit
// log. A smaller limit never deletes what is already there; it only stops new additions (history versions past a
// smaller per-note count are pruned the next time the note is snapshotted).
import { PrismaClient, type Prisma } from "@prisma/client";

const FIELDS = ["maxVaults", "maxAttachmentBytes", "maxSyncConnections", "maxSnapshotsPerNote", "maxCollaboratorsPerVault", "aiRequestsPerMonth"] as const;
type Field = (typeof FIELDS)[number];

const USAGE = `usage:
  plan.js list
  plan.js assign <email> <planId>
  plan.js set <planId> <${FIELDS.join("|")}> <number|unlimited>
  plan.js create <planId> <name>          (starts with no limits; then use set)`;

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const show = (v: number | bigint | null) => (v === null ? "unlimited" : String(v));

const [command, ...args] = process.argv.slice(2);
const prisma = new PrismaClient();
try {
  if (command === "list") {
    const plans = await prisma.plan.findMany({ orderBy: { id: "asc" }, include: { _count: { select: { users: true } } } });
    for (const p of plans) {
      console.log(`${p.id} (${p.name}) — users: ${p._count.users}`);
      for (const f of FIELDS) console.log(`  ${f}: ${show(p[f])}`);
    }
  } else if (command === "assign") {
    const [rawEmail, planId] = args;
    if (!rawEmail || !planId) fail(USAGE);
    const email = rawEmail.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, planId: true } });
    if (!user) fail("no user with that email");
    if (!(await prisma.plan.findUnique({ where: { id: planId } }))) fail(`no plan "${planId}" (see: plan.js list)`);
    // Awaited: this process exits right after, so a fire-and-forget log could be lost.
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { planId } }),
      prisma.auditLog.create({
        data: { userId: user.id, action: "plan_assigned", resourceType: "user", resourceId: user.id, metadata: { from: user.planId, to: planId } },
      }),
    ]);
    console.log(`OK: ${email} is now on "${planId}" (was "${user.planId}")`);
  } else if (command === "set") {
    const [planId, field, raw] = args;
    if (!planId || !field || raw === undefined) fail(USAGE);
    if (!FIELDS.includes(field as Field)) fail(`unknown field "${field}"; one of: ${FIELDS.join(", ")}`);
    let value: number | bigint | null = null;
    if (raw !== "unlimited") {
      if (!/^\d+$/.test(raw)) fail("value must be a whole number or 'unlimited'");
      value = field === "maxAttachmentBytes" ? BigInt(raw) : Number(raw);
      if (typeof value === "number" && value > 2_147_483_647) fail("value too large");
    }
    const before = await prisma.plan.findUnique({ where: { id: planId } });
    if (!before) fail(`no plan "${planId}" (see: plan.js list)`);
    await prisma.$transaction([
      prisma.plan.update({ where: { id: planId }, data: { [field]: value } as Prisma.PlanUpdateInput }),
      prisma.auditLog.create({
        data: { action: "plan_changed", resourceType: "plan", resourceId: planId, metadata: { field, from: show(before[field as Field]), to: show(value) } },
      }),
    ]);
    console.log(`OK: ${planId}.${field} = ${show(value)}`);
  } else if (command === "create") {
    const [planId, name] = args;
    if (!planId || !name) fail(USAGE);
    if (!/^[a-z0-9-]{1,40}$/.test(planId)) fail("plan id: lower-case letters, digits and dashes");
    await prisma.$transaction([
      prisma.plan.create({ data: { id: planId, name } }),
      prisma.auditLog.create({ data: { action: "plan_changed", resourceType: "plan", resourceId: planId, metadata: { created: name } } }),
    ]);
    console.log(`OK: plan "${planId}" created with no limits`);
  } else {
    fail(USAGE);
  }
} finally {
  await prisma.$disconnect();
}
