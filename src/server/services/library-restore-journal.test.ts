import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, expect, test } from "vitest";

import { appConfig } from "../config";
import * as client from "../db/client";
import { books } from "../db/schema";
import {
  beginLibraryRestore,
  commitLibraryRestore,
  recoverLibraryRestore,
  restorePaths,
} from "./library-restore-journal";

const journalPath = path.join(appConfig.dataDir, ".library-restore.json");
const exists = async (filePath: string) => stat(filePath).then(() => true, () => false);

beforeEach(async () => {
  await rm(appConfig.dataDir, { recursive: true, force: true });
  await rm(appConfig.storageDir, { recursive: true, force: true });
  await mkdir(appConfig.dataDir, { recursive: true });
  await mkdir(appConfig.storageDir, { recursive: true });
});

const prepare = async (renames: number) => {
  const id = randomUUID();
  const paths = restorePaths(id);
  await mkdir(paths.books);
  await writeFile(path.join(paths.books, "original.epub"), "original book");
  await writeFile(paths.database, "original database");
  await writeFile(paths.backup, "original backup");
  const stagedBooks = path.join(appConfig.storageDir, "staged-books");
  await mkdir(stagedBooks);
  await writeFile(path.join(stagedBooks, "replacement.epub"), "replacement book");
  await writeFile(paths.newDatabase, "replacement database");
  const journal = await beginLibraryRestore(id);
  const moves = [
    [paths.books, paths.oldBooks],
    [paths.database, paths.oldDatabase],
    [paths.backup, paths.oldBackup],
    [stagedBooks, paths.books],
    [paths.newDatabase, paths.database],
  ];
  for (const [source, destination] of moves.slice(0, renames)) {
    await rename(source, destination);
  }
  return { paths, journal };
};

const expectOriginal = async (paths: ReturnType<typeof restorePaths>) => {
  expect(await readFile(path.join(paths.books, "original.epub"), "utf8")).toBe("original book");
  expect(await exists(path.join(paths.books, "replacement.epub"))).toBe(false);
  expect(await readFile(paths.database, "utf8")).toBe("original database");
  expect(await readFile(paths.backup, "utf8")).toBe("original backup");
  for (const filePath of [paths.oldBooks, paths.oldDatabase, paths.oldBackup, paths.newDatabase, journalPath]) {
    expect(await exists(filePath)).toBe(false);
  }
};

describe("library restore crash recovery", () => {
  test.each([0, 1, 2, 3, 4, 5])("rolls back a prepared restore after %i renames", async (renames) => {
    const { paths } = await prepare(renames);
    await recoverLibraryRestore();
    await expectOriginal(paths);
    await recoverLibraryRestore();
    await expectOriginal(paths);
  });

  test.each([1, 2, 3])("can resume rollback after recovering %i original paths", async (recovered) => {
    const { paths } = await prepare(5);
    const originals = [
      [paths.books, paths.oldBooks],
      [paths.database, paths.oldDatabase],
      [paths.backup, paths.oldBackup],
    ];
    for (const [current, previous] of originals.slice(0, recovered)) {
      await rm(current, { recursive: true, force: true });
      await rename(previous, current);
    }
    await recoverLibraryRestore();
    await expectOriginal(paths);
  });

  test("resumes rollback when interrupted after removing the replacement database", async () => {
    const { paths } = await prepare(5);
    await rm(paths.database);
    await recoverLibraryRestore();
    await expectOriginal(paths);
  });

  test("removes replacement SQLite sidecars when restoring the original database", async () => {
    const { paths } = await prepare(5);
    await writeFile(`${paths.database}-wal`, "replacement wal");
    await writeFile(`${paths.database}-shm`, "replacement shm");
    await recoverLibraryRestore();
    await expectOriginal(paths);
    expect(await exists(`${paths.database}-wal`)).toBe(false);
    expect(await exists(`${paths.database}-shm`)).toBe(false);
  });

  test("preserves the committed replacement and cleans old copies", async () => {
    const { paths, journal } = await prepare(5);
    await writeFile(paths.backup, "replacement backup");
    await commitLibraryRestore(journal);
    await recoverLibraryRestore();
    await recoverLibraryRestore();
    expect(await readFile(paths.database, "utf8")).toBe("replacement database");
    expect(await readFile(paths.backup, "utf8")).toBe("replacement backup");
    expect(await readFile(path.join(paths.books, "replacement.epub"), "utf8")).toBe("replacement book");
    for (const filePath of [paths.oldBooks, paths.oldDatabase, paths.oldBackup, journalPath]) {
      expect(await exists(filePath)).toBe(false);
    }
  });

  test.each(["database", "books"] as const)("keeps recovery copies if committed %s is missing", async (key) => {
    const { paths, journal } = await prepare(5);
    await commitLibraryRestore(journal);
    await rm(paths[key], { recursive: true, force: true });

    await expect(recoverLibraryRestore()).rejects.toThrow("recovery copies have been kept");
    expect(await readFile(paths.oldDatabase, "utf8")).toBe("original database");
    expect(await readFile(paths.oldBackup, "utf8")).toBe("original backup");
    expect(await readFile(path.join(paths.oldBooks, "original.epub"), "utf8")).toBe("original book");
    expect(JSON.parse(await readFile(journalPath, "utf8")).phase).toBe("committed");
  });

  test("recovers the catalog before SQLite startup when both database copies were moved aside", async () => {
    const id = randomUUID();
    const paths = restorePaths(id);
    await mkdir(paths.books);
    const bookPath = path.join(paths.books, "original.epub");
    await writeFile(bookPath, "original book");
    try {
      await client.initializeDatabase();
      client.ensureSchema();
      client.db.insert(books).values({
        id: "original-book",
        title: "Original catalog entry",
        author: "Original author",
        filePath: bookPath,
        fileHash: "original-hash",
        sourceFilename: "original.epub",
        fileSizeBytes: 13,
        importedAt: new Date(),
      }).run();
      await client.backupDatabase();
      client.closeDatabase();

      await beginLibraryRestore(id);
      await rename(paths.books, paths.oldBooks);
      await rename(paths.database, paths.oldDatabase);
      await rename(paths.backup, paths.oldBackup);
      expect(await exists(paths.database)).toBe(false);
      expect(await exists(paths.backup)).toBe(false);

      await recoverLibraryRestore();
      await client.initializeDatabase();
      client.ensureSchema();
      expect(client.db.select({ id: books.id, title: books.title }).from(books).all()).toEqual([
        { id: "original-book", title: "Original catalog entry" },
      ]);
      expect(await readFile(bookPath, "utf8")).toBe("original book");
      expect(await exists(paths.backup)).toBe(true);
      expect(await exists(journalPath)).toBe(false);
    } finally {
      client.closeDatabase();
    }
  });

  test("rolls back a restore whose original library had no files", async () => {
    const id = randomUUID();
    const paths = restorePaths(id);
    await beginLibraryRestore(id);
    await mkdir(paths.books);
    await writeFile(paths.database, "replacement database");
    await writeFile(paths.backup, "replacement backup");
    await recoverLibraryRestore();
    expect(await exists(paths.books)).toBe(false);
    expect(await exists(paths.database)).toBe(false);
    expect(await exists(paths.backup)).toBe(false);
  });

  test("refuses a second restore while recovery is pending", async () => {
    const { paths } = await prepare(3);
    await expect(beginLibraryRestore(randomUUID())).rejects.toThrow("still needs recovery");
    await recoverLibraryRestore();
    await expectOriginal(paths);
  });

  test.each(["books", "database", "backup"] as const)("fails closed when the original %s is missing", async (key) => {
    const { paths } = await prepare(0);
    await rm(paths[key], { recursive: true, force: true });
    await expect(recoverLibraryRestore()).rejects.toThrow("is missing");
    expect(await exists(journalPath)).toBe(true);
  });

  test.each([
    "not json",
    JSON.stringify({ id: "../../outside", phase: "prepared", hadBooks: true, hadDatabase: true, hadBackup: true }),
    JSON.stringify({ id: randomUUID(), phase: "invalid", hadBooks: true, hadDatabase: true, hadBackup: true }),
    JSON.stringify({ id: randomUUID(), phase: "prepared", hadBooks: true, hadDatabase: true }),
  ])("leaves library files untouched for an invalid journal: %s", async (invalidJournal) => {
    const { paths } = await prepare(0);
    await writeFile(journalPath, invalidJournal);
    await expect(recoverLibraryRestore()).rejects.toThrow();
    expect(await readFile(paths.database, "utf8")).toBe("original database");
    expect(await readFile(paths.backup, "utf8")).toBe("original backup");
    expect(await readFile(path.join(paths.books, "original.epub"), "utf8")).toBe("original book");
    expect(await readFile(journalPath, "utf8")).toBe(invalidJournal);
  });
});
