import { app } from "./app";
import { appConfig } from "./config";
import { ensureSchema } from "./db/client";
import { ensureStorageLayout } from "./lib/storage";

await ensureStorageLayout();
ensureSchema();

const server = Bun.serve({
  port: appConfig.port,
  fetch: app.fetch,
});

console.log(`Irulan listening on http://localhost:${server.port}`);
