import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";

import { app } from "./app";
import { appConfig } from "./config";
import {
  backupDatabase,
  closeDatabase,
  ensureSchema,
  getPendingDatabaseRecovery,
  initializeDatabase,
} from "./db/client";
import { recordDatabaseRecovery } from "./services/settings";
import { migrateLegacySmtpPassword } from "./services/smtp-credentials";
import { ensureStorageLayout, sweepExtractedReaderContent, sweepTrash } from "./lib/storage";

export type StartedServer = {
  hostname: string;
  port: number;
  url: string;
  close: () => Promise<void>;
};

export const startServer = async (options: { port?: number; hostname?: string } = {}) => {
  await ensureStorageLayout();
  await sweepTrash();
  await sweepExtractedReaderContent();
  await initializeDatabase();
  ensureSchema();
  migrateLegacySmtpPassword();
  recordDatabaseRecovery(getPendingDatabaseRecovery());
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
        // SQLite's online backup steps through pages with the event loop free
        // between batches, so refreshing the recovery copy costs served
        // requests nothing and must not hold up the port coming up.
        void backupDatabase();
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
                // Once nothing can arrive, fold the WAL back into the database
                // file so the library on disk is a single complete file.
                closeDatabase();
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
  startServer()
    .then((started) => {
      // Without this the WAL sidecar survives every Ctrl-C, and `data/app.db`
      // on its own is then behind the library it appears to be. Nothing is lost
      // — the next open replays the log — but someone copying that one file out
      // as a backup would not know that.
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.once(signal, () => {
          void started.close().finally(() => {
            process.exit(0);
          });
        });
      }
    })
    .catch((error) => {
      console.error("Failed to start Irulan.", error);
      process.exitCode = 1;
    });
}
