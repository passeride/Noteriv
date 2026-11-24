import type { MetadataRoute } from "next";

// Makes the web app installable (Android/desktop Chrome "Install app", iOS "Add to Home Screen" uses the apple
// metadata in layout.tsx). The icons are the desktop app's, cut to the sizes browsers ask for.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Noteriv",
    short_name: "Noteriv",
    description: "Markdown notes in your browser and on your phone",
    id: "/vaults",
    start_url: "/vaults",
    scope: "/",
    display: "standalone",
    background_color: "#1e1e2e",
    theme_color: "#1e1e2e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Quick note",
        short_name: "Quick note",
        url: "/quick",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
