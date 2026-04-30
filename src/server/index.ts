import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";

import { app } from "./app";
import { appConfig } from "./config";
import { ensureSchema, initializeDatabase } from "./db/client";
import { ensureStorageLayout } from "./lib/storage";

export type StartedServer = {
  hostname: string;
  port: number;
  url: string;
  close: () => Promise<void>;
};

export const startServer = async (options: { port?: number; hostname?: string } = {}) => {
  await ensureStorageLayout();
  await initializeDatabase();
  ensureSchema();

  const hostname = options.hostname ?? "127.0.0.1";
  const requestedPort = options.port ?? appConfig.port;

  return new Promise<StartedServer>((resolve, reject) => {
    const server = serve(
      {
        fetch: app.fetch,
        hostname,
        port: requestedPort,
      },
      (info: AddressInfo) => {
        const url = `http://${hostname}:${info.port}`;
        console.log(`Irulan listening on ${url}`);
        resolve({
          hostname,
          port: info.port,
          url,
          close: () =>
            new Promise<void>((closeResolve, closeReject) => {
              server.close((error) => {
                if (error) {
                  closeReject(error);
                  return;
                }
                closeResolve();
              });
            }),
        });
      },
    );

    server.once("error", reject);

    if ("timeout" in server) {
      server.timeout = appConfig.serverIdleTimeout * 1000;
    }
  });
};

if (process.env.IRULAN_SERVER_ENTRYPOINT !== "electron") {
  startServer().catch((error) => {
    console.error("Failed to start Irulan.", error);
    process.exitCode = 1;
  });
}
