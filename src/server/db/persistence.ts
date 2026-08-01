import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { Database, SqlJsStatic } from "sql.js";

export type OpenDatabaseResult = {
  database: Database;
  recoveredFromBackup: boolean;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown database error.";

const backupPathFor = (databasePath: string) => `${databasePath}.bak`;
const temporaryPathFor = (filePath: string) => `${filePath}.tmp`;

const removeTemporaryFile = (filePath: string) => {
  rmSync(filePath, { force: true });
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
        recoveredFromBackup: false,
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

        return { database, recoveredFromBackup: true };
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

      return { database, recoveredFromBackup: true };
    } catch (backupError) {
      throw new Error(`The database backup cannot be opened: ${errorMessage(backupError)}`, {
        cause: backupError,
      });
    }
  }

  return {
    database: new SQL.Database(),
    recoveredFromBackup: false,
  };
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
    const nextBytes = database.export();
    validateDatabaseBytes(SQL, nextBytes, "Exported database");
    writeDurableFile(databaseTemporaryPath, nextBytes);
    validateDatabaseBytes(SQL, readFileSync(databaseTemporaryPath), "Temporary database");

    if (existsSync(databasePath)) {
      const previousBytes = readFileSync(databasePath);
      validateDatabaseBytes(SQL, previousBytes, "Current database");
      writeDurableFile(backupTemporaryPath, previousBytes);
      validateDatabaseBytes(SQL, readFileSync(backupTemporaryPath), "Temporary database backup");
      renameSync(backupTemporaryPath, backupPath);
      syncParentDirectory(backupPath);
    }

    renameSync(databaseTemporaryPath, databasePath);
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
