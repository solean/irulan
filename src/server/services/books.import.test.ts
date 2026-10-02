import { existsSync } from "node:fs";
import { Readable } from "node:stream";

import { beforeEach, describe, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("./epub", () => ({ extractEpubMetadata: vi.fn() }));
vi.mock("./book-search", () => ({ queueBookSearchIndex: vi.fn() }));

import * as client from "../db/client";
import * as schema from "../db/schema";
import { bookDirectory } from "../lib/storage";
import { importBookFile, stageBookFile } from "./books";
import { extractEpubMetadata } from "./epub";
import { queueBookSearchIndex } from "./book-search";

await client.initializeDatabase();
client.ensureSchema();

const stage = () => stageBookFile(Readable.from(["epub bytes"]), "book.epub");

beforeEach(() => {
  vi.clearAllMocks();
  client.db.run(sql.raw("DROP TRIGGER IF EXISTS block_membership_insert;"));
  client.db.delete(schema.books).run();
  client.db.delete(schema.bookshelves).run();
  client.db
    .insert(schema.bookshelves)
    .values(["shelf-1", "shelf-2"].map((id, index) => ({
      id,
      name: id,
      sortOrder: index,
      createdAt: new Date(),
    })))
    .run();
  vi.mocked(extractEpubMetadata).mockResolvedValue({
    title: "Test book",
    author: "Author",
    coverBuffer: null,
    coverExtension: null,
  });
});

describe("importBookFile", () => {
  test("rolls back the book and earlier memberships when assigning a shelf fails, allowing retry", async () => {
    client.db.run(sql.raw(`CREATE TRIGGER block_membership_insert BEFORE INSERT ON book_shelves
      WHEN NEW.bookshelf_id = 'shelf-2'
      BEGIN SELECT RAISE(ABORT, 'membership blocked'); END;`));
    const file = await stage();
    await expect(importBookFile(file, ["shelf-1", "shelf-2"])).rejects.toThrow(
      "The EPUB could not be saved.",
    );
    expect(client.db.select().from(schema.books).all()).toHaveLength(0);
    expect(client.db.select().from(schema.bookShelves).all()).toHaveLength(0);
    expect(existsSync(bookDirectory(file.bookId))).toBe(false);
    expect(queueBookSearchIndex).not.toHaveBeenCalled();

    client.db.run(sql.raw("DROP TRIGGER block_membership_insert;"));
    const retry = await stage();
    const result = await importBookFile(retry, ["shelf-1", "shelf-2"]);
    expect(result.status).toBe("imported");
    expect(result.book?.bookshelves).toHaveLength(2);
    expect(client.db.select().from(schema.books).all()).toHaveLength(1);
    expect(existsSync(retry.filePath)).toBe(true);
    expect(queueBookSearchIndex).toHaveBeenCalledWith(retry.bookId);
  });

  test("rolls back when a shelf disappears during metadata extraction", async () => {
    vi.mocked(extractEpubMetadata).mockImplementationOnce(async () => {
      client.db.delete(schema.bookshelves).run();
      return { title: "Test book", author: "Author", coverBuffer: null, coverExtension: null };
    });
    const file = await stage();
    await expect(importBookFile(file, "shelf-1")).rejects.toThrow();
    expect(client.db.select().from(schema.books).all()).toHaveLength(0);
    expect(existsSync(bookDirectory(file.bookId))).toBe(false);
  });

  test("preserves committed book files when scheduling search indexing fails", async () => {
    vi.mocked(queueBookSearchIndex).mockImplementationOnce(() => {
      throw new Error("index scheduling failed");
    });
    const file = await stage();
    await expect(importBookFile(file, "shelf-1")).rejects.toThrow();
    expect(client.db.select().from(schema.books).all()).toHaveLength(1);
    expect(client.db.select().from(schema.bookShelves).all()).toHaveLength(1);
    expect(existsSync(file.filePath)).toBe(true);
  });

  test("rolls back partial shelf assignments for a duplicate while preserving the original", async () => {
    const original = await stage();
    await importBookFile(original, "shelf-1");
    client.db.delete(schema.bookShelves).run();
    client.db.run(sql.raw(`CREATE TRIGGER block_membership_insert BEFORE INSERT ON book_shelves
      WHEN NEW.bookshelf_id = 'shelf-2'
      BEGIN SELECT RAISE(ABORT, 'membership blocked'); END;`));
    const duplicate = await stage();
    await expect(importBookFile(duplicate, ["shelf-1", "shelf-2"])).rejects.toThrow();
    expect(client.db.select().from(schema.books).all()).toHaveLength(1);
    expect(client.db.select().from(schema.bookShelves).all()).toHaveLength(0);
    expect(existsSync(original.filePath)).toBe(true);
    expect(existsSync(bookDirectory(duplicate.bookId))).toBe(false);
  });

  test("discards staged files when initial shelf validation fails", async () => {
    const file = await stage();
    await expect(importBookFile(file, "missing")).rejects.toThrow();
    expect(existsSync(bookDirectory(file.bookId))).toBe(false);
    expect(extractEpubMetadata).not.toHaveBeenCalled();
  });
});
