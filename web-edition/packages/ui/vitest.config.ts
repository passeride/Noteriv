import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Renderers touch document/window (image loading, event delegation), so default to a DOM.
    environment: "jsdom",
  },
});
