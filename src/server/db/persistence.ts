import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { Database, SqlJsStatic } from "sql.js";

import type { DatabaseRecovery } from "../../shared/types";

export type OpenDatabaseResult = {
  database: Database;
  recovery: DatabaseRecovery | null;
};

/**
 * Both call sites build this from inside a `try` whose `catch` reports "the
 * backup cannot be opened", so a throw here would discard a database that was
 * in fact recovered successfully. `backupModifiedAt` is therefore best effort:
 * without it the notice just loses its "current as of" line.
 */
const recoveryRecord = (
  reason: DatabaseRecovery["reason"],
  backupPath: string,
): DatabaseRecovery => {
  let backupModifiedAt: string | null = null;
  try {
    backupModifiedAt = new Date(statSync(backupPath).mtimeMs).toISOString();
  } catch {
    /* the backup was readable a moment ago; its mtime is a nicety */
  }

  return { reason, backupModifiedAt, recoveredAt: new Date().toISOString() };
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown database error.";

const backupPathFor = (databasePath: string) => `${databasePath}.bak`;
const temporaryPathFor = (filePath: string) => `${filePath}.tmp`;

const removeTemporaryFile = (filePath: string) => {
  rmSync(filePath, { force: true });
};

const SQLITE_FILE_HEADER = Buffer.from("SQLite format 3\0", "latin1");

/**
 * Constant-time sanity check on a file that is already known to have been
 * written by us. A full `PRAGMA integrity_check` would rescan every page on
 * every save; these bytes were verified before they were written, so the only
 * thing left to catch is a file clobbered or truncated from outside the app.
 */
const looksLikeSqliteDatabase = (filePath: string) => {
  const header = Buffer.alloc(SQLITE_FILE_HEADER.length);

  try {
    const descriptor = openSync(filePath, "r");

    try {
      const bytesRead = readSync(descriptor, header, 0, header.length, 0);
      return bytesRead === header.length && header.equals(SQLITE_FILE_HEADER);
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return false;
  }
};

const assertDatabaseIntegrity = (database: Database, label: string) => {
  const result = database.exec("PRAGMA integrity_check;");
  const status = result[0]?.values[0]?.[0];

  if (status !== "ok") {
    const details = result
      .flatMap((entry) => entry.values)
      .flatMap((row) => row)
      .filter((value): value is string => typeof value === "string")
      .join("; ");
    throw new Error(`${label} failed its SQLite integrity check${details ? `: ${details}` : "."}`);
  }
};

const openValidatedDatabase = (
  SQL: SqlJsStatic,
  bytes: Uint8Array,
  label: string,
): Database => {
  let database: Database | null = null;

  try {
    database = new SQL.Database(bytes);
    assertDatabaseIntegrity(database, label);
    return database;
  } catch (error) {
    database?.close();
    throw new Error(`${label} is not a valid SQLite database: ${errorMessage(error)}`, {
      cause: error,
    });
  }
};

const validateDatabaseBytes = (SQL: SqlJsStatic, bytes: Uint8Array, label: string) => {
  const database = openValidatedDatabase(SQL, bytes, label);
  database.close();
};

const writeDurableFile = (filePath: string, bytes: Uint8Array) => {
  removeTemporaryFile(filePath);
  const descriptor = openSync(filePath, "wx", 0o600);

  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

const syncParentDirectory = (filePath: string) => {
  const descriptor = openSync(path.dirname(filePath), "r");

  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

const replaceFromBytes = (
  SQL: SqlJsStatic,
  destinationPath: string,
  bytes: Uint8Array,
  label: string,
) => {
  const temporaryPath = temporaryPathFor(destinationPath);

  try {
    writeDurableFile(temporaryPath, bytes);
    validateDatabaseBytes(SQL, readFileSync(temporaryPath), label);
    renameSync(temporaryPath, destinationPath);
    syncParentDirectory(destinationPath);
  } finally {
    removeTemporaryFile(temporaryPath);
  }
};

export const openDatabaseWithRecovery = (
  SQL: SqlJsStatic,
  databasePath: string,
): OpenDatabaseResult => {
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const backupPath = backupPathFor(databasePath);
  removeTemporaryFile(temporaryPathFor(databasePath));
  removeTemporaryFile(temporaryPathFor(backupPath));

  if (existsSync(databasePath)) {
    try {
      return {
        database: openValidatedDatabase(SQL, readFileSync(databasePath), "Primary database"),
        recovery: null,
      };
    } catch (primaryError) {
      if (!existsSync(backupPath)) {
        throw new Error(
          `The primary database is invalid and no backup is available: ${errorMessage(primaryError)}`,
          { cause: primaryError },
        );
      }

      try {
        const backupBytes = readFileSync(backupPath);
        const database = openValidatedDatabase(SQL, backupBytes, "Database backup");

        try {
          replaceFromBytes(SQL, databasePath, backupBytes, "Recovered database");
        } catch (recoveryError) {
          database.close();
          throw recoveryError;
        }

        return { database, recovery: recoveryRecord("primary-corrupt", backupPath) };
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
      const backupBytes = readFileSync(backupPath);
      const database = openValidatedDatabase(SQL, backupBytes, "Database backup");

      try {
        replaceFromBytes(SQL, databasePath, backupBytes, "Recovered database");
      } catch (recoveryError) {
        database.close();
        throw recoveryError;
      }

      return { database, recovery: recoveryRecord("primary-missing", backupPath) };
    } catch (backupError) {
      throw new Error(`The database backup cannot be opened: ${errorMessage(backupError)}`, {
        cause: backupError,
      });
    }
  }

  return {
    database: new SQL.Database(),
    recovery: null,
  };
};

/**
 * Rotate the current database file into the backup slot.
 *
 * Best effort by design. The backup exists only to recover a corrupt primary,
 * and a stale-but-valid backup still serves that purpose, so nothing here may
 * abort the save in progress: a primary that cannot be read would otherwise
 * lock out every future write while the in-memory database drifts ahead of
 * what is on disk.
 *
 * Hard-linking rather than copying keeps the primary in place for the whole
 * rotation — there is no instant where a crash leaves no database at all — and
 * costs one directory entry instead of a full read and write.
 */
const rotateBackup = (databasePath: string, backupPath: string) => {
  const backupTemporaryPath = temporaryPathFor(backupPath);

  try {
    if (!looksLikeSqliteDatabase(databasePath)) {
      // Keep whatever the backup already holds; promoting a clobbered primary
      // would throw away the last state known to be recoverable.
      console.warn(
        `Skipped the database backup: ${databasePath} is no longer a readable SQLite file.`,
      );
      return;
    }

    removeTemporaryFile(backupTemporaryPath);

    try {
      linkSync(databasePath, backupTemporaryPath);
    } catch {
      // Not every filesystem supports hard links — a library kept on an exFAT
      // external drive, say. Those still deserve a backup, so fall back to a
      // durable copy and pay for it only where linking cannot work.
      writeDurableFile(backupTemporaryPath, readFileSync(databasePath));
    }

    renameSync(backupTemporaryPath, backupPath);
  } catch (error) {
    removeTemporaryFile(backupTemporaryPath);
    console.warn(`Could not refresh the database backup at ${backupPath}.`, error);
  }
};

export const persistDatabaseAtomically = (
  SQL: SqlJsStatic,
  database: Database,
  databasePath: string,
) => {
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const backupPath = backupPathFor(databasePath);
  const databaseTemporaryPath = temporaryPathFor(databasePath);
  const backupTemporaryPath = temporaryPathFor(backupPath);

  removeTemporaryFile(databaseTemporaryPath);
  removeTemporaryFile(backupTemporaryPath);

  try {
    // The one integrity check on the write path, and the only one that buys
    // anything: it stops a corrupt export before it can reach disk. Every step
    // below moves these same verified bytes around, so re-checking them would
    // rescan the whole database for no additional guarantee.
    const nextBytes = database.export();
    validateDatabaseBytes(SQL, nextBytes, "Exported database");
    writeDurableFile(databaseTemporaryPath, nextBytes);

    if (existsSync(databasePath)) {
      rotateBackup(databasePath, backupPath);
    }

    renameSync(databaseTemporaryPath, databasePath);
    // Both renames land in this one directory, so a single flush makes both
    // directory entries durable.
    syncParentDirectory(databasePath);
  } catch (error) {
    throw new Error(`Could not persist the database safely: ${errorMessage(error)}`, {
      cause: error,
    });
  } finally {
    removeTemporaryFile(databaseTemporaryPath);
    removeTemporaryFile(backupTemporaryPath);
  }
};
