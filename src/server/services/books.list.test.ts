import { rmSync } from "node:fs";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

// Storage is redirected to a temp directory by `src/test/setup.ts`, preloaded for the
// whole run, so these imports are plain static ones and `appConfig` is already safe.
import { appConfig } from "../config";
import * as client from "../db/client";
import * as schema from "../db/schema";
import { listBooks } from "./books";
import { listBookshelves, listBookshelvesForBook, listBookshelvesForBooks } from "./bookshelves";

await client.initializeDatabase();
client.ensureSchema();

const now = new Date();

const chunk = <T>(values: T[], size: number) => {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
};

const addBookshelves = (names: string[]) => {
  client.db
    .insert(schema.bookshelves)
    .values(
      names.map((name, index) => ({
        id: `shelf-${index}`,
        name,
        kindleEmail: null,
        sortOrder: index,
        createdAt: now,
      })),
    )
    .run();
};

/** Insert `count` books, newest first by import time, and return their ids. */
const addBooks = (count: number) => {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `book-${index}`,
    title: `Title ${index}`,
    author: `Author ${index}`,
    filePath: `/tmp/book-${index}/original.epub`,
    coverPath: null,
    fileHash: `hash-${index}`,
    sourceFilename: `book-${index}.epub`,
    fileSizeBytes: 1024,
    importedAt: new Date(now.getTime() - index * 1000),
    readStatus: "unread" as const,
    rating: null,
  }));

  for (const batch of chunk(rows, 50)) {
    client.db.insert(schema.books).values(batch).run();
  }

  return rows.map((row) => row.id);
};

const addMemberships = (pairs: Array<[string, string]>) => {
  for (const batch of chunk(pairs, 200)) {
    client.db
      .insert(schema.bookShelves)
      .values(batch.map(([bookId, bookshelfId]) => ({ bookId, bookshelfId, addedAt: now })))
      .run();
  }
};

beforeEach(() => {
  client.db.delete(schema.bookShelves).run();
  client.db.delete(schema.books).run();
  client.db.delete(schema.bookshelves).run();
});

afterAll(() => {
  rmSync(appConfig.storageDir, { force: true, recursive: true });
});

describe("listBooks shelf memberships", () => {
  test("attaches each book's own shelves and nothing else", () => {
    addBookshelves(["Alpha", "Beta", "Gamma"]);
    addBooks(3);
    addMemberships([
      ["book-0", "shelf-0"],
      ["book-0", "shelf-2"],
      ["book-1", "shelf-1"],
    ]);

    const byId = new Map(listBooks().books.map((book) => [book.id, book]));

    expect(byId.get("book-0")?.bookshelves.map((s) => s.name)).toEqual(["Alpha", "Gamma"]);
    expect(byId.get("book-1")?.bookshelves.map((s) => s.name)).toEqual(["Beta"]);
    // A book on no shelf must come back with an empty list, not a missing key.
    expect(byId.get("book-2")?.bookshelves).toEqual([]);
  });

  test("orders each book's shelves by sort order then name", () => {
    // Insert out of order so a naive implementation would echo insertion order.
    client.db
      .insert(schema.bookshelves)
      .values([
        { id: "shelf-late", name: "Zulu", kindleEmail: null, sortOrder: 0, createdAt: now },
        { id: "shelf-mid", name: "Alpha", kindleEmail: null, sortOrder: 5, createdAt: now },
        { id: "shelf-early", name: "Mike", kindleEmail: null, sortOrder: 0, createdAt: now },
      ])
      .run();
    addBooks(1);
    addMemberships([
      ["book-0", "shelf-mid"],
      ["book-0", "shelf-late"],
      ["book-0", "shelf-early"],
    ]);

    // sortOrder 0 ties break on name: Mike before Zulu, then sortOrder 5.
    expect(listBooks().books[0]?.bookshelves.map((s) => s.name)).toEqual(["Mike", "Zulu", "Alpha"]);
  });

  test("reports each shelf's total book count, not the current page's", () => {
    addBookshelves(["Alpha", "Beta"]);
    addBooks(4);
    addMemberships([
      ["book-0", "shelf-0"],
      ["book-1", "shelf-0"],
      ["book-2", "shelf-0"],
      ["book-3", "shelf-1"],
    ]);

    const onlyBeta = listBooks({ bookshelfId: "shelf-1" }).books;
    expect(onlyBeta).toHaveLength(1);
    // Beta holds one book; the count must not be affected by the filter.
    expect(onlyBeta[0]?.bookshelves[0]?.bookCount).toBe(1);

    const alphaBook = listBooks().books.find((book) => book.id === "book-0");
    expect(alphaBook?.bookshelves[0]?.bookCount).toBe(3);
  });

  test("keeps memberships correct for a page deep in a large library", () => {
    addBookshelves(["Alpha", "Beta"]);
    const bookIds = addBooks(950);
    addMemberships(bookIds.map((id, index) => [id, `shelf-${index % 2}`]));

    const listed = listBooks({ offset: 900, limit: 50 }).books;
    expect(listed).toHaveLength(50);
    expect(listed.every((book) => book.bookshelves.length === 1)).toBe(true);

    const byId = new Map(listed.map((book) => [book.id, book]));
    expect(byId.get("book-900")?.bookshelves[0]?.name).toBe("Alpha");
    expect(byId.get("book-901")?.bookshelves[0]?.name).toBe("Beta");
    expect(byId.get("book-949")?.bookshelves[0]?.name).toBe("Beta");
    expect(byId.get("book-900")?.bookshelves[0]?.bookCount).toBe(475);
  });

  test("matches the per-book lookup it replaced", () => {
    addBookshelves(["Alpha", "Beta", "Gamma"]);
    const bookIds = addBooks(25);
    addMemberships(
      bookIds.flatMap((id, index): Array<[string, string]> => {
        if (index % 3 === 0) return [];
        if (index % 3 === 2) return [[id, "shelf-2"]];
        return [
          [id, "shelf-1"],
          [id, "shelf-2"],
        ];
      }),
    );

    // The batched path must agree with resolving one book at a time.
    for (const book of listBooks().books) {
      expect(book.bookshelves).toEqual(listBookshelvesForBook(book.id));
    }
  });

  test("applies the search filter without disturbing memberships", () => {
    addBookshelves(["Alpha"]);
    addBooks(20);
    addMemberships([["book-7", "shelf-0"]]);

    const found = listBooks({ query: "Title 7" }).books;
    expect(found.map((book) => book.id)).toEqual(["book-7"]);
    expect(found[0]?.bookshelves.map((s) => s.name)).toEqual(["Alpha"]);
  });
});

describe("listBooks pagination", () => {
  test("returns bounded, non-overlapping pages with global totals", () => {
    addBookshelves(["Alpha"]);
    const bookIds = addBooks(125);
    addMemberships(bookIds.map((bookId) => [bookId, "shelf-0"]));

    const first = listBooks({ bookshelfId: "shelf-0" });
    const second = listBooks({ bookshelfId: "shelf-0", offset: first.limit });
    const last = listBooks({ bookshelfId: "shelf-0", offset: 120 });

    expect(first.books).toHaveLength(60);
    expect(first.books[0]?.id).toBe("book-0");
    expect(first.books[59]?.id).toBe("book-59");
    expect(second.books).toHaveLength(60);
    expect(second.books[0]?.id).toBe("book-60");
    expect(second.books[59]?.id).toBe("book-119");
    expect(last.books.map((book) => book.id)).toEqual([
      "book-120",
      "book-121",
      "book-122",
      "book-123",
      "book-124",
    ]);
    expect(first).toMatchObject({
      limit: 60,
      offset: 0,
      total: 125,
      unfilteredTotal: 125,
      statusCounts: { all: 125, unread: 125, reading: 0, finished: 0 },
    });
    expect(second.offset).toBe(60);
    expect(last.total).toBe(125);
  });

  test("computes status counts outside the page and applies status before limiting", () => {
    addBookshelves(["Alpha"]);
    const bookIds = addBooks(6);
    addMemberships(bookIds.map((bookId) => [bookId, "shelf-0"]));
    client.db
      .update(schema.books)
      .set({ readStatus: "reading" })
      .where(eq(schema.books.id, "book-0"))
      .run();
    client.db
      .update(schema.books)
      .set({ readStatus: "reading" })
      .where(eq(schema.books.id, "book-1"))
      .run();
    client.db
      .update(schema.books)
      .set({ readStatus: "finished" })
      .where(eq(schema.books.id, "book-2"))
      .run();

    const first = listBooks({
      bookshelfId: "shelf-0",
      readStatus: "reading",
      limit: 1,
    });
    const second = listBooks({
      bookshelfId: "shelf-0",
      readStatus: "reading",
      limit: 1,
      offset: 1,
    });

    expect(first.books.map((book) => book.id)).toEqual(["book-0"]);
    expect(second.books.map((book) => book.id)).toEqual(["book-1"]);
    expect(first.total).toBe(2);
    expect(first.unfilteredTotal).toBe(6);
    expect(first.statusCounts).toEqual({
      all: 6,
      unread: 3,
      reading: 2,
      finished: 1,
    });
  });

  test("sorts the full result before taking a page and breaks ties by id", () => {
    addBooks(4);
    client.db
      .update(schema.books)
      .set({ fileSizeBytes: 100 })
      .where(eq(schema.books.id, "book-0"))
      .run();
    client.db
      .update(schema.books)
      .set({ fileSizeBytes: 500 })
      .where(eq(schema.books.id, "book-1"))
      .run();
    client.db
      .update(schema.books)
      .set({ fileSizeBytes: 500 })
      .where(eq(schema.books.id, "book-2"))
      .run();
    client.db
      .update(schema.books)
      .set({ fileSizeBytes: 300 })
      .where(eq(schema.books.id, "book-3"))
      .run();

    const first = listBooks({
      sort: "fileSizeBytes",
      direction: "desc",
      limit: 2,
    });
    const second = listBooks({
      sort: "fileSizeBytes",
      direction: "desc",
      limit: 2,
      offset: 2,
    });

    expect(first.books.map((book) => book.id)).toEqual(["book-1", "book-2"]);
    expect(second.books.map((book) => book.id)).toEqual(["book-3", "book-0"]);
  });

  test("reports the shelf total separately from search results", () => {
    addBookshelves(["Alpha"]);
    const bookIds = addBooks(20);
    addMemberships(bookIds.map((bookId) => [bookId, "shelf-0"]));

    const page = listBooks({ bookshelfId: "shelf-0", query: "Title 7" });

    expect(page.books.map((book) => book.id)).toEqual(["book-7"]);
    expect(page.total).toBe(1);
    expect(page.unfilteredTotal).toBe(20);
    expect(page.statusCounts).toEqual({
      all: 1,
      unread: 1,
      reading: 0,
      finished: 0,
    });
  });
});

describe("search escaping", () => {
  const addTitled = (entries: Array<[string, string]>) => {
    const now2 = new Date();
    client.db
      .insert(schema.books)
      .values(
        entries.map(([id, title], index) => ({
          id,
          title,
          author: `Author ${index}`,
          filePath: `/tmp/${id}/original.epub`,
          coverPath: null,
          fileHash: `hash-${id}`,
          sourceFilename: `${id}.epub`,
          fileSizeBytes: 1024,
          importedAt: new Date(now2.getTime() - index * 1000),
          readStatus: "unread" as const,
          rating: null,
        })),
      )
      .run();
  };

  const titlesFor = (query: string) => listBooks({ query }).books.map((book) => book.title).sort();

  beforeEach(() => {
    addTitled([
      ["b-pct", "100% Cotton"],
      ["b-plain", "One Hundred Books"],
      ["b-under", "a_b test"],
      ["b-any", "axb test"],
      ["b-slash", "back\\slash"],
    ]);
  });

  test("treats % as a literal, not a wildcard", () => {
    // Unescaped this becomes "%100%%" and matches far more than it should.
    expect(titlesFor("100%")).toEqual(["100% Cotton"]);
  });

  test("treats _ as a literal, not a single-character wildcard", () => {
    // "a_b" would otherwise also match "axb".
    expect(titlesFor("a_b")).toEqual(["a_b test"]);
  });

  test("treats a lone % as a search for that character", () => {
    expect(titlesFor("%")).toEqual(["100% Cotton"]);
  });

  test("treats the escape character itself as a literal", () => {
    expect(titlesFor("back\\slash")).toEqual(["back\\slash"]);
  });

  test("still matches ordinary substrings, case-insensitively", () => {
    expect(titlesFor("cotton")).toEqual(["100% Cotton"]);
    expect(titlesFor("hundred")).toEqual(["One Hundred Books"]);
  });

  test("returns nothing when the literal text is absent", () => {
    expect(titlesFor("%%%")).toEqual([]);
  });
});

describe("listBookshelvesForBooks", () => {
  test("returns an empty map for no ids without touching the database", () => {
    expect(listBookshelvesForBooks([]).size).toBe(0);
  });

  test("omits books that are on no shelf", () => {
    addBookshelves(["Alpha"]);
    addBooks(2);
    addMemberships([["book-0", "shelf-0"]]);

    const grouped = listBookshelvesForBooks(["book-0", "book-1", "missing"]);
    expect(grouped.get("book-0")?.map((s) => s.name)).toEqual(["Alpha"]);
    expect(grouped.has("book-1")).toBe(false);
    expect(grouped.has("missing")).toBe(false);
  });
});

describe("listBookshelves", () => {
  test("counts books per shelf in one pass", () => {
    addBookshelves(["Alpha", "Beta", "Gamma"]);
    addBooks(3);
    addMemberships([
      ["book-0", "shelf-0"],
      ["book-1", "shelf-0"],
      ["book-2", "shelf-1"],
    ]);

    expect(listBookshelves().map((shelf) => [shelf.name, shelf.bookCount])).toEqual([
      ["Alpha", 2],
      ["Beta", 1],
      // An empty shelf still reports zero rather than dropping out of the group by.
      ["Gamma", 0],
    ]);
  });
});
