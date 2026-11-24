import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    // Plugin views are React or plain DOM, mounted into a container: give the tests a DOM.
    environment: "jsdom",
  },
});
