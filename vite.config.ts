import path from "node:path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const webPort = Number(env.WEB_PORT ?? 5173);
  const apiPort = Number(env.PORT ?? 8787);

  if (Number.isNaN(webPort) || Number.isNaN(apiPort)) {
    throw new Error("WEB_PORT and PORT must be valid numbers.");
  }

  return {
    plugins: [react(), tailwindcss()],
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
