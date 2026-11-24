/**
 * OpenAI Codex OAuth Provider:
 * Implements Device Code Flow with official OpenAI Codex Client ID to leverage
 * monthly ChatGPT Plus / Team / Pro subscriptions without pay-per-token API fees.
 * Inspired by JAVIS OS `server/openai_oauth.py`.
 */

export const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export interface CodexDeviceAuthSession {
  deviceAuthId: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

export interface CodexAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  id_token?: string;
  account_id?: string;
}

export type CodexPollResult =
  | { status: "pending" }
  | { status: "approved"; tokens: CodexAuthTokens }
  | { status: "expired" | "error"; error?: string };

/**
 * Initiates Device Code Flow: requests a user code and verification URL.
 */
export async function startCodexDeviceAuth(
  clientId: string = OPENAI_CODEX_CLIENT_ID
): Promise<CodexDeviceAuthSession> {
  const resp = await fetch("https://auth.openai.com/api/accounts/deviceauth/usercode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Failed to initiate Codex device auth (${resp.status}): ${errText}`);
  }

  const data = (await resp.json()) as {
    device_auth_id: string;
    user_code: string;
    verification_url?: string;
    expires_in: number;
    interval?: number;
  };

  return {
    deviceAuthId: data.device_auth_id,
    userCode: data.user_code,
    verificationUrl: data.verification_url || "https://auth.openai.com/codex/device",
    expiresIn: data.expires_in,
    interval: data.interval || 5,
  };
}

/**
 * Polls the token endpoint once to check if user has approved the code in their browser.
 */
export async function pollCodexDeviceToken(
  deviceAuthId: string,
  userCode: string,
  clientId: string = OPENAI_CODEX_CLIENT_ID
): Promise<CodexPollResult> {
  try {
    const resp = await fetch("https://auth.openai.com/api/accounts/deviceauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_auth_id: deviceAuthId,
        user_code: userCode,
        client_id: clientId,
      }),
    });

    if (resp.status === 200) {
      const tokens = (await resp.json()) as CodexAuthTokens;
      return { status: "approved", tokens };
    }

    if (resp.status === 403 || resp.status === 400) {
      const err = await resp.json().catch(() => ({}));
      const errCode = (err as any).error || "";
      if (errCode === "authorization_pending" || resp.status === 403) {
        return { status: "pending" };
      }
      if (errCode === "expired_token" || errCode === "code_expired") {
        return { status: "expired" };
      }
    }

    return { status: "pending" };
  } catch (e: any) {
    return { status: "error", error: e?.message || String(e) };
  }
}
