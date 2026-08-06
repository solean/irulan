import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

import { openDatabaseWithRecovery, persistDatabaseAtomically } from "./persistence";

let SQL: SqlJsStatic;
let testDirectory: string;
let databasePath: string;

const backupPath = () => `${databasePath}.bak`;
const temporaryPath = () => `${databasePath}.tmp`;
const backupTemporaryPath = () => `${backupPath()}.tmp`;

const createDatabase = () => {
  const database = new SQL.Database();
  database.run("CREATE TABLE entries (name TEXT PRIMARY KEY NOT NULL);");
  return database;
};

const addEntry = (database: Database, name: string) => {
  database.run("INSERT INTO entries (name) VALUES (?);", [name]);
};

const readEntries = (filePath: string) => {
  const database = new SQL.Database(readFileSync(filePath));

  try {
    const result = database.exec("SELECT name FROM entries ORDER BY name;");
    return (result[0]?.values ?? []).map((row) => row[0]);
  } finally {
    database.close();
  }
};

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => path.join(process.cwd(), "node_modules/sql.js/dist", file),
  });
  testDirectory = mkdtempSync(path.join(os.tmpdir(), "irulan-persistence-tests-"));
});

beforeEach(() => {
  rmSync(testDirectory, { force: true, recursive: true });
  databasePath = path.join(testDirectory, "data", "app.db");
  mkdirSync(path.dirname(databasePath), { recursive: true });
});

afterAll(() => {
  rmSync(testDirectory, { force: true, recursive: true });
});

describe("database persistence", () => {
  test("atomically replaces the primary database and rotates the prior state", () => {
    const database = createDatabase();

    try {
      addEntry(database, "first");
      persistDatabaseAtomically(SQL, database, databasePath);

      expect(readEntries(databasePath)).toEqual(["first"]);
      expect(existsSync(backupPath())).toBe(false);
      expect(existsSync(temporaryPath())).toBe(false);

      addEntry(database, "second");
      persistDatabaseAtomically(SQL, database, databasePath);

      expect(readEntries(databasePath)).toEqual(["first", "second"]);
      expect(readEntries(backupPath())).toEqual(["first"]);
      expect(existsSync(temporaryPath())).toBe(false);
      expect(existsSync(backupTemporaryPath())).toBe(false);
    } finally {
      database.close();
    }
  });

  test("saves over a clobbered primary instead of failing every later write", () => {
    const database = createDatabase();

    try {
      addEntry(database, "first");
      persistDatabaseAtomically(SQL, database, databasePath);
      addEntry(database, "second");
      persistDatabaseAtomically(SQL, database, databasePath);

      writeFileSync(databasePath, "not a sqlite database");

      addEntry(database, "third");
      persistDatabaseAtomically(SQL, database, databasePath);

      expect(readEntries(databasePath)).toEqual(["first", "second", "third"]);
      // The clobbered file must not be rotated over the last recoverable state.
      expect(readEntries(backupPath())).toEqual(["first"]);
      expect(existsSync(temporaryPath())).toBe(false);
      expect(existsSync(backupTemporaryPath())).toBe(false);
    } finally {
      database.close();
    }
  });

  test("keeps the backup independent of the primary after rotation", () => {
    const database = createDatabase();

    try {
      addEntry(database, "first");
      persistDatabaseAtomically(SQL, database, databasePath);
      addEntry(database, "second");
      persistDatabaseAtomically(SQL, database, databasePath);

      // The rotation hard-links the primary into the backup slot, so the next
      // save must not write through that link and take the backup with it.
      addEntry(database, "third");
      persistDatabaseAtomically(SQL, database, databasePath);

      expect(readEntries(databasePath)).toEqual(["first", "second", "third"]);
      expect(readEntries(backupPath())).toEqual(["first", "second"]);
    } finally {
      database.close();
    }
  });

  test("recovers an invalid primary database from the known-good backup", () => {
    const database = createDatabase();

    addEntry(database, "recoverable");
    persistDatabaseAtomically(SQL, database, databasePath);
    addEntry(database, "latest");
    persistDatabaseAtomically(SQL, database, databasePath);
    database.close();

    writeFileSync(databasePath, "not a sqlite database");

    const opened = openDatabaseWithRecovery(SQL, databasePath);
    try {
      expect(opened.recovery?.reason).toBe("primary-corrupt");
      expect(opened.recovery?.backupModifiedAt).toBeString();
      const result = opened.database.exec("SELECT name FROM entries ORDER BY name;");
      expect((result[0]?.values ?? []).map((row) => row[0])).toEqual(["recoverable"]);
    } finally {
      opened.database.close();
    }

    expect(readEntries(databasePath)).toEqual(["recoverable"]);
    expect(readEntries(backupPath())).toEqual(["recoverable"]);
    expect(existsSync(temporaryPath())).toBe(false);
  });

  test("reports a missing primary separately from a corrupt one", () => {
    const database = createDatabase();

    addEntry(database, "recoverable");
    persistDatabaseAtomically(SQL, database, databasePath);
    addEntry(database, "latest");
    persistDatabaseAtomically(SQL, database, databasePath);
    database.close();

    // A crash between rotateBackup and the rename leaves the backup alone.
    rmSync(databasePath);

    const opened = openDatabaseWithRecovery(SQL, databasePath);
    try {
      // The reason decides whether the user is shown a data-loss notice, so
      // the two recovery branches must stay distinguishable.
      expect(opened.recovery?.reason).toBe("primary-missing");
    } finally {
      opened.database.close();
    }

    expect(readEntries(databasePath)).toEqual(["recoverable"]);
  });

  test("discards stale temporary files without replacing a valid primary", () => {
    const database = createDatabase();
    addEntry(database, "committed");
    persistDatabaseAtomically(SQL, database, databasePath);
    database.close();

    writeFileSync(temporaryPath(), "interrupted primary write");
    writeFileSync(backupTemporaryPath(), "interrupted backup write");

    const opened = openDatabaseWithRecovery(SQL, databasePath);
    try {
      expect(opened.recovery).toBeNull();
      const result = opened.database.exec("SELECT name FROM entries;");
      expect(result[0]?.values[0]?.[0]).toBe("committed");
    } finally {
      opened.database.close();
    }

    expect(existsSync(temporaryPath())).toBe(false);
    expect(existsSync(backupTemporaryPath())).toBe(false);
    expect(readEntries(databasePath)).toEqual(["committed"]);
  });

  test("refuses to replace an invalid primary when no backup exists", () => {
    writeFileSync(databasePath, "not a sqlite database", { flag: "w" });

    expect(() => openDatabaseWithRecovery(SQL, databasePath)).toThrow(
      "The primary database is invalid and no backup is available",
    );
  });
});
