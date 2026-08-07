import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { DatabaseRecovery } from "../../shared/types";

export type OpenDatabaseResult = {
  database: Database.Database;
  recovery: DatabaseRecovery | null;
};

/**
 * Built from inside a `catch` that is about to report a successful recovery, so
 * a throw here would turn a rescued database into a startup failure.
 * `backupModifiedAt` is best effort: without it the notice just loses its
 * "current as of" line.
 */
const recoveryRecord = (
  reason: DatabaseRecovery["reason"],
  backupPath: string,
): DatabaseRecovery => {
  let backupModifiedAt: string | null = null;
  try {
    backupModifiedAt = new Date(statSync(backupPath).mtimeMs).toISOString();
  } catch {
    /* the backup opened a moment ago; its mtime is a nicety */
  }

  return { reason, backupModifiedAt, recoveredAt: new Date().toISOString() };
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown database error.";

export const backupPathFor = (databasePath: string) => `${databasePath}.bak`;
const temporaryPathFor = (filePath: string) => `${filePath}.tmp`;

/**
 * WAL keeps readers off the writer's back, and `synchronous = FULL` fsyncs the
 * WAL on every commit so a power cut cannot lose an acknowledged write. A
 * single-row update still measures ~0.003 ms, so there is nothing to buy by
 * weakening it.
 */
const configureConnection = (database: Database.Database) => {
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = FULL");
  database.pragma("foreign_keys = ON");
};

/**
 * `quick_check` costs ~20 ms on a 40 MB library where a full `integrity_check`
 * costs over two seconds, and it already catches the damage that matters at
 * startup: a truncated, clobbered, or non-SQLite file. The expensive check is
 * only worth running once this one has something to report.
 */
const assertReadable = (database: Database.Database, label: string) => {
  const rows = database.pragma("quick_check") as { quick_check: string }[];
  const status = rows[0]?.quick_check;

  if (status !== "ok") {
    const details = rows.map((row) => row.quick_check).join("; ");
    throw new Error(`${label} failed its SQLite quick check: ${details || "no detail reported"}.`);
  }
};

const openVerified = (databasePath: string, label: string) => {
  const database = new Database(databasePath, { fileMustExist: true });

  try {
    assertReadable(database, label);
    configureConnection(database);
    return database;
  } catch (error) {
    database.close();
    throw new Error(`${label} cannot be used: ${errorMessage(error)}`, { cause: error });
  }
};

/**
 * Copy through a temporary file so an interrupted restore cannot leave a
 * half-written primary in place of the one file we know is intact.
 *
 * The `-wal` and `-shm` sidecars belong to the file being replaced, and SQLite
 * pairs a WAL with its database by salt, not by name. Leaving them next to a
 * different database invites a replay against pages they were never written
 * for, so they go with the file they described.
 */
const restoreFromBackup = (databasePath: string, backupPath: string) => {
  const temporaryPath = temporaryPathFor(databasePath);

  try {
    copyFileSync(backupPath, temporaryPath);
    renameSync(temporaryPath, databasePath);
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
  } finally {
    rmSync(temporaryPath, { force: true });
  }
};

/**
 * A recovered primary is replaced on disk before it is opened, so the app never
 * runs against a file it could not also reopen after a restart.
 */
const recoverFromBackup = (
  databasePath: string,
  backupPath: string,
  reason: DatabaseRecovery["reason"],
): OpenDatabaseResult => {
  // Verify the backup where it lies: promoting it first would destroy the only
  // intact copy if it turns out to be damaged too.
  openVerified(backupPath, "Database backup").close();

  const recovery = recoveryRecord(reason, backupPath);
  restoreFromBackup(databasePath, backupPath);

  return { database: openVerified(databasePath, "Recovered database"), recovery };
};

export const openDatabaseWithRecovery = (databasePath: string): OpenDatabaseResult => {
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const backupPath = backupPathFor(databasePath);
  rmSync(temporaryPathFor(databasePath), { force: true });
  rmSync(temporaryPathFor(backupPath), { force: true });

  if (existsSync(databasePath)) {
    try {
      return { database: openVerified(databasePath, "Primary database"), recovery: null };
    } catch (primaryError) {
      if (!existsSync(backupPath)) {
        throw new Error(
          `The primary database is invalid and no backup is available: ${errorMessage(primaryError)}`,
          { cause: primaryError },
        );
      }

      try {
        return recoverFromBackup(databasePath, backupPath, "primary-corrupt");
      } catch (backupError) {
        throw new Error(
          `Neither the primary database nor its backup can be opened. Primary: ${errorMessage(primaryError)} Backup: ${errorMessage(backupError)}`,
          { cause: backupError },
        );
      }
    }
  }

  if (existsSync(backupPath)) {
    try {
      return recoverFromBackup(databasePath, backupPath, "primary-missing");
    } catch (backupError) {
      throw new Error(`The database backup cannot be opened: ${errorMessage(backupError)}`, {
        cause: backupError,
      });
    }
  }

  const database = new Database(databasePath);
  configureConnection(database);

  return { database, recovery: null };
};

/**
 * Refresh the recovery copy of the database.
 *
 * `Database.backup` is SQLite's online backup, stepped in small page batches
 * with the event loop free between them, so this can run while requests are
 * being served. That is the whole reason the backup no longer rides along with
 * every write: it is a guard against a damaged file, not a transaction log, and
 * one consistent copy per startup serves that purpose without charging every
 * rating click 62 ms.
 *
 * Best effort by design. A stale-but-valid backup still recovers a corrupt
 * primary, so a failure here must never take down a working server.
 */
export const refreshDatabaseBackup = async (
  database: Database.Database,
  databasePath: string,
): Promise<void> => {
  const backupPath = backupPathFor(databasePath);
  const temporaryPath = temporaryPathFor(backupPath);
  // Cleanup runs on the failure path, where throwing would defeat the point of
  // treating the backup as best effort.
  const discardTemporary = () => {
    try {
      rmSync(temporaryPath, { force: true, recursive: true });
    } catch (error) {
      console.warn(`Could not remove the stale backup copy at ${temporaryPath}.`, error);
    }
  };

  try {
    discardTemporary();
    await database.backup(temporaryPath);
    renameSync(temporaryPath, backupPath);
  } catch (error) {
    discardTemporary();
    console.warn(`Could not refresh the database backup at ${backupPath}.`, error);
  }
};
