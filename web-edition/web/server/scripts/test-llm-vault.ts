// Run: npx tsx scripts/test-llm-vault.ts
// Covers lib/credentials-vault.ts and routes/llm-keys.ts without a database: the route runs against an
// in-memory stand-in for the one Prisma model it uses, so the "enc:" and not-readable checks look at the
// exact string the route hands to the database.
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  decrypt,
  encrypt,
  generateFernetKey,
  getVaultKey,
  resetVaultKeyCache,
} from "../src/lib/credentials-vault.js";
import llmKeyRoutes from "../src/routes/llm-keys.js";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

process.env.ENCRYPTION_KEY = "test-passphrase-not-a-real-secret";
const SECRET = "sk-ant-api03-SUPER-SECRET-VALUE-123456";

await test("encrypt/decrypt roundtrip", () => {
  const key = generateFernetKey();
  const token = encrypt(key, SECRET);
  assert.ok(token.startsWith("enc:"));
  assert.ok(!token.includes(SECRET));
  assert.equal(decrypt(key, token), SECRET);
  assert.equal(decrypt(key, encrypt(key, "")), "");
  assert.equal(decrypt(key, encrypt(key, "kiểm tra ✓")), "kiểm tra ✓");
});

await test("same plaintext encrypts differently each time (random IV)", () => {
  const key = generateFernetKey();
  assert.notEqual(encrypt(key, SECRET), encrypt(key, SECRET));
});

await test("wrong key and tampered token are rejected", () => {
  const token = encrypt(generateFernetKey(), SECRET);
  assert.throws(() => decrypt(generateFernetKey(), token), /verification/);
  const key = generateFernetKey();
  const good = encrypt(key, SECRET);
  const flipped = good.slice(0, -4) + (good.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.throws(() => decrypt(key, flipped));
  assert.throws(() => decrypt(key, "enc:short"));
  assert.throws(() => decrypt(key, SECRET), /Unknown credential format/);
});

await test("plain: is refused in production, readable in dev", () => {
  const key = generateFernetKey();
  assert.equal(decrypt(key, "plain:abc"), "abc");
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(() => decrypt(key, "plain:abc"), /production/);
  } finally {
    process.env.NODE_ENV = prev;
  }
});

await test("getVaultKey is stable and requires ENCRYPTION_KEY in production", () => {
  resetVaultKeyCache();
  assert.equal(getVaultKey(), getVaultKey());
  const saved = process.env.ENCRYPTION_KEY;
  const prev = process.env.NODE_ENV;
  delete process.env.ENCRYPTION_KEY;
  process.env.NODE_ENV = "production";
  resetVaultKeyCache();
  try {
    assert.throws(() => getVaultKey(), /ENCRYPTION_KEY/);
  } finally {
    process.env.ENCRYPTION_KEY = saved;
    process.env.NODE_ENV = prev;
    resetVaultKeyCache();
  }
});

// --- routes ---------------------------------------------------------------------------------------------------
type Row = { id: string; userId: string; provider: string; keyEncrypted: string; createdAt: Date };
const rows: Row[] = [];
const fakePrisma = {
  llmApiKey: {
    async upsert({ where, create, update }: any) {
      const { userId, provider } = where.userId_provider;
      const existing = rows.find((r) => r.userId === userId && r.provider === provider);
      if (existing) Object.assign(existing, update);
      else rows.push({ id: `id${rows.length}`, createdAt: new Date(), ...create });
    },
    async findMany({ where }: any) {
      return rows.filter((r) => r.userId === where.userId).sort((a, b) => a.provider.localeCompare(b.provider));
    },
    async deleteMany({ where }: any) {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].userId === where.userId && rows[i].provider === where.provider) rows.splice(i, 1);
      }
      return { count: before - rows.length };
    },
  },
};

const app = Fastify();
app.decorate("prisma", fakePrisma as any);
app.decorateRequest("user", null);
app.decorate("authenticate", async (request: any, reply: any) => {
  const id = request.headers["x-test-user"];
  if (!id) return reply.code(401).send({ error: "unauthorized" });
  request.user = { id, email: `${id}@example.com` };
});
await app.register(llmKeyRoutes, { prefix: "/api/v1/llm-keys" });

const as = (user: string) => ({ "x-test-user": user });

await test("requires authentication", async () => {
  const res = await app.inject({ method: "GET", url: "/api/v1/llm-keys" });
  assert.equal(res.statusCode, 401);
});

await test("POST stores the key as enc: and never in plaintext", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/llm-keys",
    headers: as("u1"),
    payload: { provider: "claude", apiKey: SECRET },
  });
  assert.equal(res.statusCode, 201);
  assert.ok(!res.body.includes(SECRET));
  assert.equal(rows.length, 1);
  assert.ok(rows[0].keyEncrypted.startsWith("enc:"));
  assert.ok(!rows[0].keyEncrypted.includes(SECRET));
  assert.ok(!JSON.stringify(rows).includes(SECRET), "key must not be readable from the stored row");
  assert.equal(decrypt(getVaultKey(), rows[0].keyEncrypted), SECRET);
});

await test("POST again for the same provider replaces, not duplicates", async () => {
  await app.inject({ method: "POST", url: "/api/v1/llm-keys", headers: as("u1"), payload: { provider: "claude", apiKey: "sk-replacement-key" } });
  assert.equal(rows.length, 1);
  assert.equal(decrypt(getVaultKey(), rows[0].keyEncrypted), "sk-replacement-key");
});

await test("POST validates input", async () => {
  for (const payload of [{}, { provider: "Bad Name", apiKey: SECRET }, { provider: "openai", apiKey: "short" }]) {
    const res = await app.inject({ method: "POST", url: "/api/v1/llm-keys", headers: as("u1"), payload });
    assert.equal(res.statusCode, 400);
  }
});

await test("GET lists provider names only, scoped to the user", async () => {
  await app.inject({ method: "POST", url: "/api/v1/llm-keys", headers: as("u1"), payload: { provider: "openai", apiKey: SECRET } });
  await app.inject({ method: "POST", url: "/api/v1/llm-keys", headers: as("u2"), payload: { provider: "gemini", apiKey: SECRET } });
  const res = await app.inject({ method: "GET", url: "/api/v1/llm-keys", headers: as("u1") });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().providers.map((p: any) => p.provider), ["claude", "openai"]);
  assert.ok(!res.body.includes("enc:") && !res.body.includes("sk-"));
});

await test("DELETE removes only the caller's key", async () => {
  assert.equal((await app.inject({ method: "DELETE", url: "/api/v1/llm-keys/gemini", headers: as("u1") })).statusCode, 404);
  assert.equal((await app.inject({ method: "DELETE", url: "/api/v1/llm-keys/claude", headers: as("u1") })).statusCode, 204);
  assert.equal((await app.inject({ method: "DELETE", url: "/api/v1/llm-keys/claude", headers: as("u1") })).statusCode, 404);
  assert.deepEqual(rows.map((r) => `${r.userId}:${r.provider}`).sort(), ["u1:openai", "u2:gemini"]);
});

await app.close();
console.log(`\n${passed} passed`);
