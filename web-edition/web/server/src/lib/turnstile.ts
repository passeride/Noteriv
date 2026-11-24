// Cloudflare Turnstile: the bot check on the sign-up and forgot-password forms. On only when both keys are set
// (TURNSTILE_SITE_KEY, public, goes to the page through GET /auth/registration; TURNSTILE_SECRET_KEY stays here).

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 10_000;

/** The public site key the page renders the widget with, or null when the check is off. */
export function turnstileSiteKey(): string | null {
  const site = process.env.TURNSTILE_SITE_KEY?.trim();
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  return site && secret ? site : null;
}

export const turnstileEnabled = (): boolean => turnstileSiteKey() !== null;

/**
 * Asks Cloudflare whether `token` (from the widget on the page) is a passed check. Fails closed: no token, an
 * unreachable Cloudflare or any unexpected answer all count as not passed, so an outage cannot open the forms to bots.
 */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret || !token) return false;
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: unknown };
    return body.success === true;
  } catch {
    return false;
  }
}
