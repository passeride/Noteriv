/**
 * Browser WebSocket connections send an Origin header. Non-browser clients (Tauri/desktop, tests)
 * might omit it. Allow known domains, APP_ORIGIN / CORS_ORIGIN / APP_URL, ALLOWED_ORIGINS, localhost, or non-browser requests.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const host = parsed.host.toLowerCase();
    if (parsed.protocol === "tauri:" || host === "tauri.localhost") return true;
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return true;

    const allowedHosts = new Set<string>();
    allowedHosts.add("noteriv.dsc.edu.vn");
    allowedHosts.add("staging-noteriv.dsc.edu.vn");

    const envOrigins = [
      process.env.APP_ORIGIN,
      process.env.CORS_ORIGIN,
      process.env.PUBLIC_ORIGIN,
      process.env.APP_URL,
    ];
    for (const envOrigin of envOrigins) {
      if (envOrigin) {
        try {
          allowedHosts.add(new URL(envOrigin).host.toLowerCase());
        } catch {
          allowedHosts.add(envOrigin.toLowerCase());
        }
      }
    }

    if (process.env.ALLOWED_ORIGINS) {
      for (const item of process.env.ALLOWED_ORIGINS.split(",")) {
        const trimmed = item.trim();
        if (trimmed) {
          try {
            allowedHosts.add(new URL(trimmed).host.toLowerCase());
          } catch {
            allowedHosts.add(trimmed.toLowerCase());
          }
        }
      }
    }
    return allowedHosts.has(host);
  } catch {
    return false;
  }
}
