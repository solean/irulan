import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, test } from "vitest";

import { app } from "../app";
import { appConfig } from "../config";
import * as client from "../db/client";
import * as schema from "../db/schema";
import { bookDirectory } from "../lib/storage";
import { searchBook } from "./book-search";

await client.initializeDatabase();
client.ensureSchema();

const BOOK_ID = "backup-book";
const SHELF_ID = "backup-shelf";
const FIXTURE_PATH = path.join(appConfig.rootDir, "src/test/fixtures/multi-section.epub");
const fixtureBytes = readFileSync(FIXTURE_PATH);
const fixtureHash = createHash("sha256").update(fixtureBytes).digest("hex");
const originalPath = path.join(bookDirectory(BOOK_ID), "original.epub");
const coverPath = path.join(bookDirectory(BOOK_ID), "cover.png");

beforeEach(() => {
  client.db.delete(schema.readerAnnotations).run();
  client.db.delete(schema.readerBookmarks).run();
  client.db.delete(schema.bookShelves).run();
  client.db.delete(schema.books).run();
  client.db.delete(schema.bookshelves).run();
  client.db.delete(schema.settings).run();
  rmSync(appConfig.storageDir, { force: true, recursive: true });
  mkdirSync(bookDirectory(BOOK_ID), { recursive: true });
  writeFileSync(originalPath, fixtureBytes);
  writeFileSync(coverPath, Buffer.from("fixture-cover"));

  client.db
    .insert(schema.bookshelves)
    .values({ id: SHELF_ID, name: "Restored shelf", kindleEmail: null, sortOrder: 0, createdAt: new Date() })
    .run();
  client.db
    .insert(schema.books)
    .values({
      id: BOOK_ID,
      title: "The Three Rooms",
      author: "Fixture Author",
      filePath: originalPath,
      coverPath,
      fileHash: fixtureHash,
      sourceFilename: "multi-section.epub",
      fileSizeBytes: fixtureBytes.length,
      importedAt: new Date("2026-08-12T10:00:00.000Z"),
      readStatus: "reading",
      rating: 4.5,
    })
    .run();
  client.db
    .insert(schema.bookShelves)
    .values({ bookId: BOOK_ID, bookshelfId: SHELF_ID, addedAt: new Date() })
    .run();
  client.db.insert(schema.settings).values({ key: "backup-test", value: "preserved" }).run();
  client.db
    .insert(schema.readerBookmarks)
    .values({
      id: "saved-bookmark",
      bookId: BOOK_ID,
      label: "Garden",
      sectionHref: "OEBPS/chapter-2.xhtml",
      textVersion: 1,
      offset: 36,
      prefix: "Beyond the stair, a glass garden ",
      suffix: "kept summer through the longest winter.",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  client.db
    .insert(schema.readerAnnotations)
    .values({
      id: "saved-annotation",
      bookId: BOOK_ID,
      sectionHref: "OEBPS/chapter-2.xhtml",
      textVersion: 1,
      offset: 120,
      endOffset: 130,
      exact: "needleword",
      prefix: "Mira found the ",
      suffix: " growing between silver leaves",
      color: "blue",
      note: "A restored note",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
});

describe("complete library backup and restore", () => {
  test("restores books, covers, metadata, shelves, bookmarks, annotations, and search", async () => {
    const backupResponse = await app.fetch(new Request("http://127.0.0.1/api/library/backup"));
    expect(backupResponse.status).toBe(200);
    expect(backupResponse.headers.get("content-type")).toBe("application/zip");
    expect(backupResponse.headers.get("content-disposition")).toMatch(/irulan-library-\d{4}-\d{2}-\d{2}\.zip/);
    const backupBytes = Buffer.from(await backupResponse.arrayBuffer());
    expect(backupBytes.length).toBeGreaterThan(fixtureBytes.length);

    client.db.delete(schema.bookShelves).run();
    client.db.delete(schema.books).run();
    client.db.delete(schema.bookshelves).run();
    client.db.delete(schema.settings).run();
    rmSync(appConfig.storageDir, { force: true, recursive: true });

    const restoreResponse = await app.fetch(
      new Request("http://127.0.0.1/api/library/restore", {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: backupBytes,
      }),
    );
    expect(restoreResponse.status).toBe(200);
    expect(await restoreResponse.json()).toMatchObject({ restore: { bookCount: 1 } });

    const restoredBook = client.db.select().from(schema.books).get();
    expect(restoredBook).toMatchObject({
      id: BOOK_ID,
      title: "The Three Rooms",
      filePath: originalPath,
      coverPath,
      readStatus: "reading",
      rating: 4.5,
    });
    expect(readFileSync(originalPath)).toEqual(fixtureBytes);
    expect(readFileSync(coverPath).toString()).toBe("fixture-cover");
    expect(client.db.select().from(schema.bookshelves).get()).toMatchObject({
      id: SHELF_ID,
      name: "Restored shelf",
    });
    expect(client.db.select().from(schema.settings).get()).toEqual({
      key: "backup-test",
      value: "preserved",
    });
    expect(client.db.select().from(schema.readerBookmarks).get()).toMatchObject({
      id: "saved-bookmark",
      label: "Garden",
    });
    expect(client.db.select().from(schema.readerAnnotations).get()).toMatchObject({
      id: "saved-annotation",
      exact: "needleword",
      color: "blue",
      note: "A restored note",
    });

    const search = await searchBook(BOOK_ID, { query: "needleword" });
    expect(search.results[0]).toMatchObject({
      sectionHref: "OEBPS/chapter-2.xhtml",
      sectionLabel: "The Glass Garden",
    });
    expect(search.results[0]?.snippet.length).toBeLessThanOrEqual(240);
  });

  test("rejects an invalid archive before changing the current library", async () => {
    const response = await app.fetch(
      new Request("http://127.0.0.1/api/library/restore", {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: Buffer.from("not a zip"),
      }),
    );

    expect(response.status).toBe(400);
    expect(client.db.select().from(schema.books).get()?.id).toBe(BOOK_ID);
    expect(readFileSync(originalPath)).toEqual(fixtureBytes);
  });
});
