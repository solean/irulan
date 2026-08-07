import { defineConfig } from "vitest/config";

// Kept apart from vite.config.ts on purpose: that config exists to build the React
// client and carries the react plugin, the theme-bootstrap HTML transform, and a dev
// proxy — none of which a server test needs, and all of which would run on every
// test invocation. vitest picks this file over vite.config.ts when both exist.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "electron/**/*.test.ts"],
    // Redirects storage to a temp directory before the app config snapshots the
    // environment. See the comment in the setup file for why that ordering matters.
    setupFiles: ["./src/test/setup.ts"],
  },
});
