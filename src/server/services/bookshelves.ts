import { randomUUID } from "node:crypto";

import { asc, count, eq, inArray, sql } from "drizzle-orm";

import type { BookshelvesPayload, BookshelfSummary } from "../../shared/types";
import { db } from "../db/client";
import { books, bookshelves, bookShelves, deliveries } from "../db/schema";
import { AppError } from "../errors";

type BookshelfRecord = typeof bookshelves.$inferSelect;

const normalizeText = (value: string | null | undefined) => value?.trim() ?? "";
const normalizeKindleEmail = (value: string | null | undefined) => {
  const trimmed = normalizeText(value);
  return trimmed.length > 0 ? trimmed : null;
};

// Every value in an `IN (…)` list is a bound parameter, and SQLite caps how many
// a single statement may carry. Chunking well under the lowest historical limit
// (999) keeps a large library from ever tripping it.
const IN_CLAUSE_CHUNK_SIZE = 400;

const chunk = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const getBookCount = (bookshelfId: string) =>
  db
    .select({ value: count() })
    .from(bookShelves)
    .where(eq(bookShelves.bookshelfId, bookshelfId))
    .get()?.value ?? 0;

/**
 * Distinct books in the library, which is not the sum of the shelf counts: a
 * book on several shelves is counted by each of them, and a book on no shelf
 * (every shelf holding it was deleted, say) is counted by none.
 */
const countLibraryBooks = () => db.select({ value: count() }).from(books).get()?.value ?? 0;

/** Book totals for every shelf at once, so a list render never counts per shelf. */
const getBookCountsByBookshelf = (): Map<string, number> =>
  new Map(
    db
      .select({ bookshelfId: bookShelves.bookshelfId, value: count() })
      .from(bookShelves)
      .groupBy(bookShelves.bookshelfId)
      .all()
      .map((row) => [row.bookshelfId, row.value] as const),
  );

const toBookshelfSummary = (
  bookshelf: BookshelfRecord,
  bookCount: number,
): BookshelfSummary => ({
  id: bookshelf.id,
  name: bookshelf.name,
  kindleEmail: bookshelf.kindleEmail?.trim() || null,
  bookCount,
  createdAt: bookshelf.createdAt.toISOString(),
});

export const serializeBookshelf = (bookshelf: BookshelfRecord): BookshelfSummary =>
  toBookshelfSummary(bookshelf, getBookCount(bookshelf.id));

export const listBookshelves = (): BookshelfSummary[] => {
  const bookCounts = getBookCountsByBookshelf();

  return db
    .select()
    .from(bookshelves)
    .orderBy(asc(bookshelves.sortOrder), asc(bookshelves.name))
    .all()
    .map((bookshelf) => toBookshelfSummary(bookshelf, bookCounts.get(bookshelf.id) ?? 0));
};

export const getBookshelfList = (): BookshelvesPayload => ({
  bookshelves: listBookshelves(),
  libraryBookCount: countLibraryBooks(),
});

/**
 * Shelf memberships for many books, keyed by book id.
 *
 * Resolving these one book at a time is what made listing a library quadratic:
 * a membership query per book, and a `COUNT(*)` per shelf on every one of them.
 * Here the counts are gathered once and the memberships in a handful of queries
 * regardless of how many books are asked for.
 */
export const listBookshelvesForBooks = (
  bookIds: string[],
): Map<string, BookshelfSummary[]> => {
  const grouped = new Map<string, BookshelfSummary[]>();
  if (bookIds.length === 0) {
    return grouped;
  }

  const bookCounts = getBookCountsByBookshelf();

  for (const bookIdChunk of chunk(bookIds, IN_CLAUSE_CHUNK_SIZE)) {
    const rows = db
      .select({
        bookId: bookShelves.bookId,
        id: bookshelves.id,
        name: bookshelves.name,
        kindleEmail: bookshelves.kindleEmail,
        sortOrder: bookshelves.sortOrder,
        createdAt: bookshelves.createdAt,
      })
      .from(bookShelves)
      .innerJoin(bookshelves, eq(bookShelves.bookshelfId, bookshelves.id))
      .where(inArray(bookShelves.bookId, bookIdChunk))
      .orderBy(asc(bookshelves.sortOrder), asc(bookshelves.name))
      .all();

    for (const row of rows) {
      const summary = toBookshelfSummary(row, bookCounts.get(row.id) ?? 0);
      const existing = grouped.get(row.bookId);
      if (existing) {
        existing.push(summary);
      } else {
        grouped.set(row.bookId, [summary]);
      }
    }
  }

  return grouped;
};

export const listBookshelvesForBook = (bookId: string): BookshelfSummary[] =>
  listBookshelvesForBooks([bookId]).get(bookId) ?? [];

export const getBookshelfRecord = (bookshelfId: string) => {
  const row = db.select().from(bookshelves).where(eq(bookshelves.id, bookshelfId)).get();
  if (!row) {
    throw new AppError(404, "Bookshelf not found.");
  }
  return row;
};

export const getFirstBookshelfRecord = () => {
  const row = db
    .select()
    .from(bookshelves)
    .orderBy(asc(bookshelves.sortOrder), asc(bookshelves.name))
    .get();

  if (!row) {
    throw new AppError(500, "No bookshelf is available.");
  }

  return row;
};

export const resolveBookshelfRecord = (bookshelfId?: string | null) =>
  bookshelfId?.trim() ? getBookshelfRecord(bookshelfId.trim()) : getFirstBookshelfRecord();

export const createBookshelf = ({
  kindleEmail,
  name,
}: {
  name: string;
  kindleEmail?: string | null;
}) => {
  const trimmedName = normalizeText(name);
  if (!trimmedName) {
    throw new AppError(400, "Bookshelf name is required.");
  }

  const nextSortOrder =
    (db
      .select({ value: sql<number>`coalesce(max(${bookshelves.sortOrder}), -1) + 1` })
      .from(bookshelves)
      .get()?.value ?? 0);

  const id = randomUUID();
  db.insert(bookshelves)
    .values({
      id,
      name: trimmedName,
      kindleEmail: normalizeKindleEmail(kindleEmail),
      sortOrder: nextSortOrder,
      createdAt: new Date(),
    })
    .run();

  return serializeBookshelf(getBookshelfRecord(id));
};

export const updateBookshelf = (
  bookshelfId: string,
  {
    kindleEmail,
    name,
  }: {
    name: string;
    kindleEmail?: string | null;
  },
) => {
  getBookshelfRecord(bookshelfId);

  const trimmedName = normalizeText(name);
  if (!trimmedName) {
    throw new AppError(400, "Bookshelf name is required.");
  }

  db.update(bookshelves)
    .set({
      name: trimmedName,
      kindleEmail: normalizeKindleEmail(kindleEmail),
    })
    .where(eq(bookshelves.id, bookshelfId))
    .run();

  return serializeBookshelf(getBookshelfRecord(bookshelfId));
};

export const deleteBookshelf = (bookshelfId: string) => {
  const shelf = getBookshelfRecord(bookshelfId);
  const shelfCount = db.select({ value: count() }).from(bookshelves).get()?.value ?? 0;

  if (shelfCount <= 1) {
    throw new AppError(400, "Keep at least one bookshelf.");
  }

  db.update(deliveries)
    .set({ bookshelfId: null })
    .where(eq(deliveries.bookshelfId, bookshelfId))
    .run();
  db.delete(bookShelves).where(eq(bookShelves.bookshelfId, bookshelfId)).run();
  db.delete(bookshelves).where(eq(bookshelves.id, bookshelfId)).run();

  return {
    id: shelf.id,
    name: shelf.name,
    message: `${shelf.name} was removed. Books remain in the shared library.`,
  };
};

export const addBookToBookshelf = (bookId: string, bookshelfId: string) => {
  const book = db.select().from(books).where(eq(books.id, bookId)).get();
  if (!book) {
    throw new AppError(404, "Book not found.");
  }

  getBookshelfRecord(bookshelfId);

  db.insert(bookShelves)
    .values({
      bookId,
      bookshelfId,
      addedAt: new Date(),
    })
    .onConflictDoNothing()
    .run();
};

export const removeBookFromBookshelf = (bookId: string, bookshelfId: string) => {
  getBookshelfRecord(bookshelfId);
  db.delete(bookShelves)
    .where(sql`${bookShelves.bookId} = ${bookId} and ${bookShelves.bookshelfId} = ${bookshelfId}`)
    .run();
};

export const replaceBookBookshelves = (bookId: string, bookshelfIds: string[]) => {
  const book = db.select().from(books).where(eq(books.id, bookId)).get();
  if (!book) {
    throw new AppError(404, "Book not found.");
  }

  const uniqueIds = Array.from(new Set(bookshelfIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    throw new AppError(400, "Choose at least one bookshelf.");
  }

  const existingShelves = db
    .select({ id: bookshelves.id })
    .from(bookshelves)
    .where(inArray(bookshelves.id, uniqueIds))
    .all();

  if (existingShelves.length !== uniqueIds.length) {
    throw new AppError(400, "One or more bookshelves could not be found.");
  }

  db.delete(bookShelves).where(eq(bookShelves.bookId, bookId)).run();
  db.insert(bookShelves)
    .values(uniqueIds.map((bookshelfId) => ({ bookId, bookshelfId, addedAt: new Date() })))
    .run();
};
