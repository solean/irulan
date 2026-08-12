import path from "node:path";

import type Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type { DatabaseRecovery } from "../../shared/types";
import { appConfig } from "../config";
import { openDatabaseWithRecovery, refreshDatabaseBackup } from "./recovery";
import { migrateDatabaseSchema } from "./migrations";
import * as schema from "./schema";

let sqlite: Database.Database | null = null;

export let db: BetterSQLite3Database<typeof schema>;

/**
 * Recovery happens before `ensureSchema` has run, so the `settings` table that
 * stores the user-visible notice may not exist yet. Hold the record here and let
 * `recordDatabaseRecovery` store it once the schema is in place.
 */
let pendingRecovery: DatabaseRecovery | null = null;

export const getPendingDatabaseRecovery = () => pendingRecovery;

export const setPendingDatabaseRecovery = (recovery: DatabaseRecovery | null) => {
  pendingRecovery = recovery;
};

const noteRecovery = (recovery: DatabaseRecovery | null) => {
  if (!recovery) {
    return;
  }

  console.warn(
    `The database was recovered from its backup (${recovery.reason}). ` +
      `Changes made after ${recovery.backupModifiedAt ?? "the backup was written"} are gone.`,
  );
  pendingRecovery = recovery;
};

const requireSqlite = () => {
  if (!sqlite) {
    throw new Error("The database has not been initialized.");
  }

  return sqlite;
};

export const initializeDatabase = async () => {
  if (sqlite) {
    return;
  }

  const opened = openDatabaseWithRecovery(appConfig.dbPath);
  sqlite = opened.database;
  noteRecovery(opened.recovery);
  db = drizzle(sqlite, { schema });
};

export const ensureSchema = () => {
  migrateDatabaseSchema(requireSqlite(), path.join(appConfig.rootDir, "drizzle"));
};

export const backupDatabase = () => refreshDatabaseBackup(requireSqlite(), appConfig.dbPath);
export const snapshotDatabase = (destinationPath: string) =>
  requireSqlite().backup(destinationPath);

/**
 * WAL leaves a `-wal` sidecar that only a clean close folds back into the
 * database file. Nothing is lost without it — the next open replays the log —
 * but a library copied out from under a killed process is easier to reason about
 * when the primary file is complete.
 */
export const closeDatabase = () => {
  sqlite?.close();
  sqlite = null;
};
