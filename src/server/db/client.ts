import path from "node:path";

import { drizzle, type SQLJsDatabase } from "drizzle-orm/sql-js";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

import type { DatabaseRecovery } from "../../shared/types";
import { appConfig } from "../config";
import { openDatabaseWithRecovery, persistDatabaseAtomically } from "./persistence";
import { migrateDatabaseSchema } from "./migrations";
import * as schema from "./schema";

let sqlite: Database | null = null;
let sqlModule: SqlJsStatic | null = null;

export let db: SQLJsDatabase<typeof schema>;

/**
 * Recovery happens before `ensureSchema` has run, so the `settings` table that
 * holds the notice may not exist yet — and on the `persistDatabase` rollback
 * path the disk is failing, so nothing can be written at all. Park the record
 * here; `services/settings` moves it to storage when it can and reads through
 * to it when it cannot.
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

  setPendingDatabaseRecovery(recovery);
  console.warn(
    `Recovered Irulan database from ${appConfig.dbPath}.bak (${recovery.reason}), ` +
      `current as of ${recovery.backupModifiedAt ?? "an unknown time"}.`,
  );
};

const requireSqlite = () => {
  if (!sqlite) {
    throw new Error("Database has not been initialized.");
  }

  return sqlite;
};

const requireSqlModule = () => {
  if (!sqlModule) {
    throw new Error("Database has not been initialized.");
  }

  return sqlModule;
};

/**
 * Point the in-memory database at what is currently stored.
 *
 * `db` is a live export binding, so every service that imported it picks up the
 * replacement on its next query rather than holding the old handle.
 */
const reloadFromDisk = () => {
  const previous = sqlite;
  const opened = openDatabaseWithRecovery(requireSqlModule(), appConfig.dbPath);

  // Only give up the working handle once the replacement is open.
  sqlite = opened.database;
  sqlite.run("PRAGMA foreign_keys = ON;");
  db = drizzle(sqlite, { schema });
  previous?.close();

  noteRecovery(opened.recovery);

  return opened.recovery;
};

export const persistDatabase = () => {
  try {
    persistDatabaseAtomically(requireSqlModule(), requireSqlite(), appConfig.dbPath);
  } catch (error) {
    // The caller already applied its change in memory, but it never reached
    // disk. Left alone, the API would report that change as saved and it would
    // disappear on the next restart, so roll memory back to what is stored and
    // let the failure surface.
    try {
      reloadFromDisk();
    } catch (reloadError) {
      console.error(
        "The database could not be saved, and the in-memory copy could not be rolled " +
          "back to match what is stored. It now holds changes that are not on disk.",
        reloadError,
      );
    }

    throw error;
  }
};

export const initializeDatabase = async () => {
  if (sqlite) {
    return;
  }

  const SQL = await initSqlJs({
    locateFile: (file) => path.join(appConfig.rootDir, "node_modules/sql.js/dist", file),
  });

  const opened = openDatabaseWithRecovery(SQL, appConfig.dbPath);
  sqlModule = SQL;
  sqlite = opened.database;
  noteRecovery(opened.recovery);
  sqlite.run("PRAGMA foreign_keys = ON;");
  db = drizzle(sqlite, { schema });
};

export const ensureSchema = () => {
  migrateDatabaseSchema(requireSqlite(), path.join(appConfig.rootDir, "drizzle"));
  persistDatabase();
};
