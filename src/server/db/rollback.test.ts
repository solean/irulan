import { chmodSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import initSqlJs from "sql.js";

// Storage is redirected to a temp directory by `src/test/setup.ts`, preloaded for the
// whole run, so these imports are plain static ones and `appConfig` is already safe.
import { appConfig } from "../config";
import * as client from "./client";
import * as schema from "./schema";
// Imported for its own `db` binding: this module resolved `db` at import time, so it
// proves the rollback reaches code that captured the handle before the swap.
import { listBookshelves } from "../services/bookshelves";

const SQL = await initSqlJs({
  locateFile: (file) => path.join(process.cwd(), "node_modules/sql.js/dist", file),
});

await client.initializeDatabase();
client.ensureSchema();

const dataDirectory = () => path.dirname(appConfig.dbPath);

/** Names held by the database file on disk, independent of what is in memory. */
const storedBookshelfNames = () => {
  const database = new SQL.Database(readFileSync(appConfig.dbPath));

  try {
    const [result] = database.exec("SELECT name FROM bookshelves ORDER BY name;");
    return (result?.values ?? []).map((row) => String(row[0]));
  } finally {
    database.close();
  }
};

const inMemoryBookshelfNames = () =>
  client.db
    .select()
    .from(schema.bookshelves)
    .all()
    .map((row) => row.name)
    .sort();

const addBookshelf = (id: string, name: string) => {
  client.db
    .insert(schema.bookshelves)
    .values({ id, name, kindleEmail: null, sortOrder: 0, createdAt: new Date() })
    .run();
};

/** Make the data directory unwritable, so creating the temp file fails with EACCES. */
const withUnwritableDataDirectory = (body: () => void) => {
  chmodSync(dataDirectory(), 0o500);

  try {
    body();
  } finally {
    chmodSync(dataDirectory(), 0o700);
  }
};

beforeEach(() => {
  client.db.delete(schema.bookShelves).run();
  client.db.delete(schema.books).run();
  client.db.delete(schema.bookshelves).run();
  addBookshelf("kept", "Kept");
  client.persistDatabase();
});

afterAll(() => {
  chmodSync(dataDirectory(), 0o700);
});

describe("persistDatabase rollback", () => {
  test("surfaces the failure instead of silently keeping the change", () => {
    withUnwritableDataDirectory(() => {
      addBookshelf("lost", "Lost");
      expect(() => client.persistDatabase()).toThrow("Could not persist the database safely");
    });
  });

  test("drops the unsaved change from memory so it cannot be read back", () => {
    withUnwritableDataDirectory(() => {
      addBookshelf("lost", "Lost");
      expect(inMemoryBookshelfNames()).toEqual(["Kept", "Lost"]);

      expect(() => client.persistDatabase()).toThrow();

      // Memory must agree with disk, or the API reports a save that never happened.
      expect(inMemoryBookshelfNames()).toEqual(["Kept"]);
      expect(storedBookshelfNames()).toEqual(["Kept"]);
    });
  });

  test("leaves services usable, on the replacement handle", () => {
    withUnwritableDataDirectory(() => {
      addBookshelf("lost", "Lost");
      expect(() => client.persistDatabase()).toThrow();
    });

    // bookshelves.ts imported `db` before the rollback replaced it. If the live
    // binding did not carry through, this throws "Database closed".
    expect(listBookshelves().map((shelf) => shelf.name)).toEqual(["Kept"]);
  });

  test("accepts writes again once the directory is writable", () => {
    withUnwritableDataDirectory(() => {
      addBookshelf("lost", "Lost");
      expect(() => client.persistDatabase()).toThrow();
    });

    addBookshelf("later", "Later");
    client.persistDatabase();

    expect(inMemoryBookshelfNames()).toEqual(["Kept", "Later"]);
    expect(storedBookshelfNames()).toEqual(["Kept", "Later"]);
  });

  test("keeps a successful save untouched", () => {
    addBookshelf("extra", "Extra");
    client.persistDatabase();

    expect(inMemoryBookshelfNames()).toEqual(["Extra", "Kept"]);
    expect(storedBookshelfNames()).toEqual(["Extra", "Kept"]);
  });
});
