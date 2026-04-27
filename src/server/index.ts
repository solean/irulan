import { app } from "./app";
import { appConfig } from "./config";
import { ensureSchema } from "./db/client";
import { ensureStorageLayout } from "./lib/storage";

await ensureStorageLayout();
ensureSchema();

const server = Bun.serve({
  port: appConfig.port,
  // EPUB uploads and import processing can exceed Bun's 10s default.
  idleTimeout: appConfig.serverIdleTimeout,
  fetch: app.fetch,
});

console.log(`Irulan listening on http://localhost:${server.port}`);
