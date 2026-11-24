import { execFileSync } from "node:child_process";
import path from "node:path";

/** Seeds the invite code the tests sign up with (web/server/scripts/e2e-invite.ts), unless one is given. */
export default function globalSetup() {
  if (process.env.E2E_SKIP_SEED) return;
  const serverDir = path.resolve(__dirname, "..", "web", "server");
  const code = execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "scripts/e2e-invite.ts"], {
    cwd: serverDir,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  })
    .trim()
    .split("\n")
    .pop()!;
  process.env.E2E_INVITE_CODE = code;
}
