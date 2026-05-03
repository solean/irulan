import { randomUUID } from "node:crypto";

import { asc, count, eq, inArray, sql } from "drizzle-orm";

import { BookshelfSummary } from "../../shared/types";
import { db, persistDatabase } from "../db/client";
import { books, bookshelves, bookShelves, deliveries } from "../db/schema";
import { AppError } from "../errors";

type BookshelfRecord = typeof bookshelves.$inferSelect;

const normalizeText = (value: string | null | undefined) => value?.trim() ?? "";
const normalizeKindleEmail = (value: string | null | undefined) => {
  const trimmed = normalizeText(value);
  return trimmed.length > 0 ? trimmed : null;
};

const getBookCount = (bookshelfId: string) =>
  db
    .select({ value: count() })
    .from(bookShelves)
    .where(eq(bookShelves.bookshelfId, bookshelfId))
    .get()?.value ?? 0;

export const serializeBookshelf = (bookshelf: BookshelfRecord): BookshelfSummary => ({
  id: bookshelf.id,
  name: bookshelf.name,
  kindleEmail: bookshelf.kindleEmail?.trim() || null,
  bookCount: getBookCount(bookshelf.id),
  createdAt: bookshelf.createdAt.toISOString(),
});

export const listBookshelves = (): BookshelfSummary[] =>
  db
    .select()
    .from(bookshelves)
    .orderBy(asc(bookshelves.sortOrder), asc(bookshelves.name))
    .all()
    .map(serializeBookshelf);

export const listBookshelvesForBook = (bookId: string): BookshelfSummary[] =>
  db
    .select({
      id: bookshelves.id,
      name: bookshelves.name,
      kindleEmail: bookshelves.kindleEmail,
      sortOrder: bookshelves.sortOrder,
      createdAt: bookshelves.createdAt,
    })
    .from(bookShelves)
    .innerJoin(bookshelves, eq(bookShelves.bookshelfId, bookshelves.id))
    .where(eq(bookShelves.bookId, bookId))
    .orderBy(asc(bookshelves.sortOrder), asc(bookshelves.name))
    .all()
    .map(serializeBookshelf);

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
  persistDatabase();

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
  persistDatabase();

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
  persistDatabase();

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
  persistDatabase();
};

export const addBookToResolvedBookshelf = (bookId: string, bookshelfId?: string | null) => {
  const bookshelf = resolveBookshelfRecord(bookshelfId);
  addBookToBookshelf(bookId, bookshelf.id);
  return bookshelf;
};

export const removeBookFromBookshelf = (bookId: string, bookshelfId: string) => {
  getBookshelfRecord(bookshelfId);
  db.delete(bookShelves)
    .where(sql`${bookShelves.bookId} = ${bookId} and ${bookShelves.bookshelfId} = ${bookshelfId}`)
    .run();
  persistDatabase();
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
  persistDatabase();
};
