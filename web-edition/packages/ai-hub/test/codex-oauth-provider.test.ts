import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  startCodexDeviceAuth,
  pollCodexDeviceToken,
  OPENAI_CODEX_CLIENT_ID,
  type CodexAuthTokens,
} from "../src/codex-oauth-provider";

describe("OpenAI Codex OAuth Provider (ChatGPT Plus/Team Subscription)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("initiates device code auth flow and returns verification code and url", async () => {
    const mockResponse = {
      device_auth_id: "dev-auth-123",
      user_code: "ABCD-EFGH",
      verification_url: "https://auth.openai.com/codex/device",
      expires_in: 900,
      interval: 5,
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = await startCodexDeviceAuth();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://auth.openai.com/api/accounts/deviceauth/usercode",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: OPENAI_CODEX_CLIENT_ID }),
      })
    );

    expect(session.userCode).toBe("ABCD-EFGH");
    expect(session.verificationUrl).toBe("https://auth.openai.com/codex/device");
    expect(session.deviceAuthId).toBe("dev-auth-123");
  });

  it("handles pending authorization during polling", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "authorization_pending" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await pollCodexDeviceToken("dev-auth-123", "ABCD-EFGH");
    expect(result.status).toBe("pending");
    expect("tokens" in result).toBe(false);
  });

  it("returns access tokens once user approves in browser", async () => {
    const mockTokens: CodexAuthTokens = {
      access_token: "mock-access-token",
      refresh_token: "mock-refresh-token",
      expires_in: 3600,
      account_id: "org-mock-plus-user",
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockTokens,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await pollCodexDeviceToken("dev-auth-123", "ABCD-EFGH");
    expect(result.status).toBe("approved");
    if (result.status === "approved") {
      expect(result.tokens.access_token).toBe("mock-access-token");
      expect(result.tokens.refresh_token).toBe("mock-refresh-token");
    }
  });
});
