import path from "node:path";
import type { NextConfig } from "next";

const API_ORIGIN = process.env.NOTERIV_API_ORIGIN ?? "http://127.0.0.1:4001";

// Origin (scheme + host) of the collab WebSocket, so the report-only policy does not flag it.
// Build-time value, like NEXT_PUBLIC_COLLAB_WS_URL itself.
const COLLAB_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_COLLAB_WS_URL ?? "").origin;
  } catch {
    return "";
  }
})();

// Full policy, REPORT-ONLY on purpose: it only shows violations in the browser console. Enforcing a
// CSP could break the plugin sandbox (public/plugin-sandbox.html, an iframe with sandbox="allow-scripts"
// and an opaque origin), the blob: iframe of the PDF preview, and Next's own inline bootstrap scripts
// (a nonce policy would force every page to render dynamically). Tighten and enforce later, with evidence.
const reportOnlyCsp = [
  "default-src 'self'",
  // Cloudflare Turnstile (sign-up, forgot password): its script, its iframe and its calls.
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${COLLAB_ORIGIN} https://challenges.cloudflare.com`.replace(/\s+/g, " "),
  "frame-src 'self' blob: https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  // This app lives in an npm workspace: packages are hoisted to the repo root's node_modules and the
  // shared code sits in ../packages. Trace from the repo root so the standalone server includes
  // them (the output then nests the app under .next/standalone/web/, see web/Dockerfile).
  outputFileTracingRoot: path.join(__dirname, ".."),
  // @noteriv/core and @noteriv/ui ship TypeScript source (no build step); compile them with the app.
  transpilePackages: ["@noteriv/core", "@noteriv/ui", "@noteriv/ai-hub", "@noteriv/plugin-api", "@noteriv/plugins"],
  // Shown in Developer > Diagnostics so "which version is deployed?" has an answer.
  env: { NEXT_PUBLIC_BUILD_TIME: new Date().toISOString() },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_ORIGIN}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // No includeSubDomains: the host is a subdomain of a domain that serves other sites.
          { key: "Strict-Transport-Security", value: "max-age=15552000" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Enforced: nothing outside this origin may frame the app. The plugin sandbox and the PDF
          // preview are framed by the app itself, so 'self' covers them.
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "Content-Security-Policy-Report-Only", value: reportOnlyCsp },
        ],
      },
      {
        // The service worker must never be served from an HTTP cache, or an old one would keep running
        // (the Next PWA guide's headers).
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
