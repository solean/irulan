import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const webPort = Number(env.WEB_PORT ?? 5173);
  const apiPort = Number(env.PORT ?? 8787);

  if (Number.isNaN(webPort) || Number.isNaN(apiPort)) {
    throw new Error("WEB_PORT and PORT must be valid numbers.");
  }

  return {
    plugins: [react()],
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
