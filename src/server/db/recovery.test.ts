import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, test } from "vitest";

import { openDatabaseWithRecovery, refreshDatabaseBackup } from "./recovery";

const testDirectory = mkdtempSync(path.join(os.tmpdir(), "irulan-recovery-"));
let databasePath: string;

const backupPath = () => `${databasePath}.bak`;
const temporaryPath = () => `${databasePath}.tmp`;

/** A standalone SQLite file with one `entries` row per supplied name. */
const seedFile = (filePath: string, names: string[]) => {
  const database = new Database(filePath);

  try {
    database.exec("CREATE TABLE entries (name TEXT PRIMARY KEY NOT NULL);");
    const insert = database.prepare("INSERT INTO entries (name) VALUES (?);");
    for (const name of names) {
      insert.run(name);
    }
  } finally {
    database.close();
  }
};

const readEntries = (filePath: string) => {
  const database = new Database(filePath, { fileMustExist: true, readonly: true });

  try {
    return database.prepare("SELECT name FROM entries ORDER BY name;").pluck().all() as string[];
  } finally {
    database.close();
  }
};

const entriesIn = (database: Database.Database) =>
  database.prepare("SELECT name FROM entries ORDER BY name;").pluck().all() as string[];

beforeEach(() => {
  rmSync(testDirectory, { force: true, recursive: true });
  mkdirSync(testDirectory, { recursive: true });
  databasePath = path.join(testDirectory, "app.db");
});

afterAll(() => {
  rmSync(testDirectory, { force: true, recursive: true });
});

describe("opening the database", () => {
  test("creates a write-ahead-logged database when nothing is stored yet", () => {
    const opened = openDatabaseWithRecovery(databasePath);

    try {
      expect(opened.recovery).toBeNull();
      expect(opened.database.pragma("journal_mode", { simple: true })).toBe("wal");
      // Foreign keys are off by default in SQLite and every cascade in the
      // schema depends on them, so the connection must arrive with them on.
      expect(opened.database.pragma("foreign_keys", { simple: true })).toBe(1);
      opened.database.exec("CREATE TABLE entries (name TEXT PRIMARY KEY NOT NULL);");
      opened.database.prepare("INSERT INTO entries (name) VALUES (?);").run("written");
      expect(entriesIn(opened.database)).toEqual(["written"]);
    } finally {
      opened.database.close();
    }
  });

  test("opens an intact primary without consulting or touching the backup", () => {
    seedFile(databasePath, ["stored"]);
    seedFile(backupPath(), ["older"]);

    const opened = openDatabaseWithRecovery(databasePath);

    try {
      expect(opened.recovery).toBeNull();
      expect(entriesIn(opened.database)).toEqual(["stored"]);
    } finally {
      opened.database.close();
    }

    expect(readEntries(backupPath())).toEqual(["older"]);
  });

  test("discards a stale temporary file without replacing a valid primary", () => {
    seedFile(databasePath, ["committed"]);
    writeFileSync(temporaryPath(), "interrupted restore");
    writeFileSync(`${backupPath()}.tmp`, "interrupted backup");

    const opened = openDatabaseWithRecovery(databasePath);

    try {
      expect(opened.recovery).toBeNull();
      expect(entriesIn(opened.database)).toEqual(["committed"]);
    } finally {
      opened.database.close();
    }

    expect(existsSync(temporaryPath())).toBe(false);
    expect(existsSync(`${backupPath()}.tmp`)).toBe(false);
  });
});

describe("recovering from the backup", () => {
  test("recovers a corrupt primary and reports it as corrupt", () => {
    seedFile(backupPath(), ["recoverable"]);
    writeFileSync(databasePath, "not a sqlite database");

    const opened = openDatabaseWithRecovery(databasePath);

    try {
      expect(opened.recovery?.reason).toBe("primary-corrupt");
      expect(typeof opened.recovery?.backupModifiedAt).toBe("string");
      expect(typeof opened.recovery?.recoveredAt).toBe("string");
      expect(entriesIn(opened.database)).toEqual(["recoverable"]);
    } finally {
      opened.database.close();
    }

    // The recovered state must survive a restart, which means it has to be the
    // file on disk and not just the open connection.
    expect(readEntries(databasePath)).toEqual(["recoverable"]);
    expect(readEntries(backupPath())).toEqual(["recoverable"]);
    expect(existsSync(temporaryPath())).toBe(false);
  });

  test("reports a missing primary separately from a corrupt one", () => {
    seedFile(backupPath(), ["recoverable"]);

    const opened = openDatabaseWithRecovery(databasePath);

    try {
      // The reason decides whether the user is shown a data-loss notice, so the
      // two recovery branches must stay distinguishable.
      expect(opened.recovery?.reason).toBe("primary-missing");
    } finally {
      opened.database.close();
    }

    expect(readEntries(databasePath)).toEqual(["recoverable"]);
  });

  test("drops the replaced primary's write-ahead log instead of replaying it", () => {
    seedFile(backupPath(), ["recoverable"]);
    writeFileSync(databasePath, "not a sqlite database");
    // A killed process leaves these behind; they describe the file being
    // replaced, so pairing them with the restored one risks a bogus replay.
    writeFileSync(`${databasePath}-wal`, "orphaned write-ahead log");
    writeFileSync(`${databasePath}-shm`, "orphaned shared memory");

    const opened = openDatabaseWithRecovery(databasePath);

    try {
      expect(opened.recovery?.reason).toBe("primary-corrupt");
      expect(entriesIn(opened.database)).toEqual(["recoverable"]);
    } finally {
      opened.database.close();
    }
  });

  test("refuses to replace an invalid primary when no backup exists", () => {
    writeFileSync(databasePath, "not a sqlite database");

    expect(() => openDatabaseWithRecovery(databasePath)).toThrow(
      "The primary database is invalid and no backup is available",
    );
  });

  test("keeps a corrupt backup out of the primary slot", () => {
    writeFileSync(databasePath, "not a sqlite database");
    writeFileSync(backupPath(), "not a sqlite database either");

    expect(() => openDatabaseWithRecovery(databasePath)).toThrow(
      "Neither the primary database nor its backup can be opened",
    );
    // Promoting an unreadable backup would destroy the evidence and leave the
    // user with two broken files instead of one.
    expect(existsSync(temporaryPath())).toBe(false);
  });

  test("rejects a primary whose pages are damaged, not just its header", () => {
    seedFile(databasePath, ["first", "second"]);
    seedFile(backupPath(), ["recoverable"]);

    // Keep a valid header and scribble over the page that holds the table, the
    // damage a header check cannot see.
    const handle = require("node:fs").openSync(databasePath, "r+");
    require("node:fs").writeSync(handle, Buffer.alloc(2048, 0x7f), 0, 2048, 4096);
    require("node:fs").closeSync(handle);

    const opened = openDatabaseWithRecovery(databasePath);

    try {
      expect(opened.recovery?.reason).toBe("primary-corrupt");
      expect(entriesIn(opened.database)).toEqual(["recoverable"]);
    } finally {
      opened.database.close();
    }
  });
});

describe("refreshing the backup", () => {
  test("writes a consistent copy that later writes do not follow", async () => {
    const opened = openDatabaseWithRecovery(databasePath);

    try {
      opened.database.exec("CREATE TABLE entries (name TEXT PRIMARY KEY NOT NULL);");
      opened.database.prepare("INSERT INTO entries (name) VALUES (?);").run("backed-up");

      await refreshDatabaseBackup(opened.database, databasePath);

      expect(readEntries(backupPath())).toEqual(["backed-up"]);
      expect(existsSync(`${backupPath()}.tmp`)).toBe(false);

      opened.database.prepare("INSERT INTO entries (name) VALUES (?);").run("later");

      // The backup is a point-in-time copy, not a live mirror; if a write bled
      // through, a corrupt primary would take the backup down with it.
      expect(readEntries(backupPath())).toEqual(["backed-up"]);
    } finally {
      opened.database.close();
    }
  });

  test("leaves the previous backup in place when a refresh cannot be taken", async () => {
    seedFile(backupPath(), ["previous"]);
    const opened = openDatabaseWithRecovery(databasePath);
    opened.database.prepare("INSERT INTO entries (name) VALUES (?);").run("newer");
    // The backup is kicked off without being awaited, so it can still be in
    // flight when the server shuts the connection. That must degrade to a stale
    // backup and a warning, never a rejected promise or a lost backup.
    opened.database.close();

    await expect(refreshDatabaseBackup(opened.database, databasePath)).resolves.toBeUndefined();

    expect(readEntries(backupPath())).toEqual(["previous"]);
    expect(existsSync(`${backupPath()}.tmp`)).toBe(false);
  });
});
