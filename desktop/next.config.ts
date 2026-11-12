import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "export",
  turbopack: { root: path.resolve(__dirname, "..") },
  images: {
    unoptimized: true,
  },
  // Tauri loads from `out/` after `next build`. Asset prefix matches Tauri default.
  assetPrefix: process.env.NODE_ENV === "production" ? "" : undefined,
};

export default nextConfig;
