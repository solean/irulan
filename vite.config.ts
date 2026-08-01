import path from "node:path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { themeBootstrapScript } from "./src/shared/theme";

const THEME_BOOTSTRAP_TOKEN = "__THEME_BOOTSTRAP__";

// index.html carries a placeholder instead of a hand-written copy of the
// pre-paint script, so the storage key and colors can never drift from the app.
const themeBootstrap = (): Plugin => ({
  name: "irulan-theme-bootstrap",
  transformIndexHtml: {
    order: "pre",
    handler(html) {
      if (!html.includes(THEME_BOOTSTRAP_TOKEN)) {
        throw new Error(`index.html is missing the ${THEME_BOOTSTRAP_TOKEN} placeholder.`);
      }
      return html.replaceAll(THEME_BOOTSTRAP_TOKEN, themeBootstrapScript);
    },
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const webPort = Number(env.WEB_PORT ?? 5173);
  const apiPort = Number(env.PORT ?? 8787);

  if (Number.isNaN(webPort) || Number.isNaN(apiPort)) {
    throw new Error("WEB_PORT and PORT must be valid numbers.");
  }

  return {
    plugins: [react(), tailwindcss(), themeBootstrap()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      outDir: "dist/client",
      emptyOutDir: true,
    },
    server: {
      port: webPort,
      proxy: {
        "/api": `http://localhost:${apiPort}`,
      },
    },
  };
});
