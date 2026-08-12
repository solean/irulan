import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";

// Storage is redirected to a temp directory by `src/test/setup.ts`, which runs before
// this file's imports, so these are plain static ones and `appConfig` is already safe.
import { appConfig } from "../config";
import * as client from "../db/client";
import * as schema from "../db/schema";
import { deleteBook } from "./books";
import { bookDirectory } from "../lib/storage";

await client.initializeDatabase();
client.ensureSchema();

const BOOK_ID = "book-1";
const SHELF_IDS = ["shelf-1", "shelf-2"];

const rowCounts = () => ({
  books: client.db.select().from(schema.books).all().length,
  shelves: client.db.select().from(schema.bookShelves).all().length,
  deliveries: client.db.select().from(schema.deliveries).all().length,
  searchSections: client.db.select().from(schema.readerSectionText).all().length,
  searchIndex:
    client.db.get<{ count: number }>(sql`SELECT count(*) AS count FROM reader_section_fts`)
      ?.count ?? 0,
});

// A second connection, so the count reflects what a reader outside this test would
// see on disk rather than one connection's uncommitted view.
const persistedShelfCount = () => {
  const database = new Database(appConfig.dbPath, { readonly: true });

  try {
    const row = database.prepare("SELECT COUNT(*) AS count FROM book_shelves;").get() as {
      count: number;
    };
    return row.count;
  } finally {
    database.close();
  }
};

/** Aborts the final `books` delete, mirroring a constraint or IO failure mid-transaction. */
const blockBookDeletes = () => {
  client.db.run(
    sql.raw(`
      CREATE TRIGGER block_book_deletes BEFORE DELETE ON books
      BEGIN SELECT RAISE(ABORT, 'books delete blocked'); END;
    `),
  );
};

beforeEach(() => {
  const now = new Date();

  client.db.run(sql.raw("DROP TRIGGER IF EXISTS block_book_deletes;"));
  client.db.run(sql.raw("DROP TRIGGER IF EXISTS block_delivery_inserts;"));
  client.db.delete(schema.deliveries).run();
  client.db.delete(schema.bookShelves).run();
  client.db.delete(schema.books).run();
  client.db.delete(schema.bookshelves).run();

  client.db
    .insert(schema.bookshelves)
    .values(
      SHELF_IDS.map((id, index) => ({
        id,
        name: `Shelf ${index + 1}`,
        kindleEmail: null,
        sortOrder: index,
        createdAt: now,
      })),
    )
    .run();

  client.db
    .insert(schema.books)
    .values({
      id: BOOK_ID,
      title: "Dune",
      author: "Frank Herbert",
      filePath: path.join(bookDirectory(BOOK_ID), "book.epub"),
      coverPath: null,
      fileHash: "hash-1",
      sourceFilename: "dune.epub",
      fileSizeBytes: 42,
      importedAt: now,
      readStatus: "unread",
      rating: null,
    })
    .run();

  client.db
    .insert(schema.readerSectionText)
    .values({
      bookId: BOOK_ID,
      href: "chapter.xhtml",
      label: "Chapter",
      spineIndex: 0,
      textVersion: 1,
      text: "Searchable text",
      indexedAt: now,
    })
    .run();

  client.db
    .insert(schema.bookShelves)
    .values(SHELF_IDS.map((bookshelfId) => ({ bookId: BOOK_ID, bookshelfId, addedAt: now })))
    .run();

  client.db
    .insert(schema.deliveries)
    .values({
      id: "delivery-1",
      bookId: BOOK_ID,
      bookshelfId: SHELF_IDS[0],
      recipientEmail: "reader@example.com",
      status: "sent",
      smtpMessageId: "msg-1",
      errorMessage: null,
      createdAt: now,
      sentAt: now,
    })
    .run();

  rmSync(appConfig.storageDir, { force: true, recursive: true });
  mkdirSync(bookDirectory(BOOK_ID), { recursive: true });
  writeFileSync(path.join(bookDirectory(BOOK_ID), "book.epub"), "epub bytes");
});

afterAll(() => {
  rmSync(appConfig.storageDir, { force: true, recursive: true });
});

describe("deleteBook", () => {
  test("keeps shelf memberships and deliveries when the book delete fails", async () => {
    blockBookDeletes();

    await expect(deleteBook(BOOK_ID)).rejects.toThrow("The book could not be deleted.");

    expect(rowCounts()).toEqual({
      books: 1,
      shelves: SHELF_IDS.length,
      deliveries: 1,
      searchSections: 1,
      searchIndex: 1,
    });
    expect(persistedShelfCount()).toBe(SHELF_IDS.length);
  });

  test("restores the book files when the book delete fails", async () => {
    blockBookDeletes();

    await expect(deleteBook(BOOK_ID)).rejects.toThrow("The book could not be deleted.");

    expect(existsSync(path.join(bookDirectory(BOOK_ID), "book.epub"))).toBe(true);
  });

  test("surfaces the delete failure instead of a rollback failure", async () => {
    blockBookDeletes();
    // A rollback that re-inserts rows by hand would itself abort here, throwing away the
    // real error and leaking a raw SQLite failure to the caller.
    client.db.run(
      sql.raw(`
        CREATE TRIGGER block_delivery_inserts BEFORE INSERT ON deliveries
        BEGIN SELECT RAISE(ABORT, 'delivery insert blocked'); END;
      `),
    );

    await expect(deleteBook(BOOK_ID)).rejects.toThrow("The book could not be deleted.");

    client.db.run(sql.raw("DROP TRIGGER IF EXISTS block_delivery_inserts;"));
    expect(rowCounts()).toEqual({
      books: 1,
      shelves: SHELF_IDS.length,
      deliveries: 1,
      searchSections: 1,
      searchIndex: 1,
    });
  });

  test("removes the book, shelf memberships, and deliveries on success", async () => {
    const result = await deleteBook(BOOK_ID);

    expect(result.id).toBe(BOOK_ID);
    expect(rowCounts()).toEqual({
      books: 0,
      shelves: 0,
      deliveries: 0,
      searchSections: 0,
      searchIndex: 0,
    });
    expect(persistedShelfCount()).toBe(0);
    expect(existsSync(bookDirectory(BOOK_ID))).toBe(false);
  });
});
