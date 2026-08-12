import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { and, asc, count, desc, eq, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import {
  BOOKS_PAGE_SIZE,
  MAX_BOOKS_PAGE_SIZE,
  type BookDetail,
  type BookListOptions,
  type BookPage,
  type BookReader,
  type BookSortKey,
  type BookshelfSummary,
  type BookSummary,
  type DeleteBookResult,
  type ImportResult,
  type ReadStatus,
  type SortDirection,
  type UpdateBookMetadataPayload,
} from "../../shared/types";
import { db } from "../db/client";
import { books, bookShelves, deliveries } from "../db/schema";
import { AppError } from "../errors";
import { bookDirectory, readerDirectory, trashDirectory } from "../lib/storage";
import { extractEpubMetadata, prepareEpubReader, readEpubReaderAsset } from "./epub";
import { queueBookSearchIndex } from "./book-search";
import {
  addBookToBookshelf,
  listBookshelvesForBook,
  listBookshelvesForBooks,
  getFirstBookshelfRecord,
  resolveBookshelfRecord,
} from "./bookshelves";

type BookRecord = typeof books.$inferSelect;
type PreparedBookReader = Awaited<ReturnType<typeof prepareEpubReader>>;

const preparedReaderRequests = new Map<string, Promise<PreparedBookReader>>();

export const MAX_EPUB_FILE_BYTES = 200 * 1024 * 1024;

export type StagedBookFile = {
  bookId: string;
  fileHash: string;
  filePath: string;
  fileSizeBytes: number;
  sourceFilename: string;
};

const fallbackTitle = (filename: string) =>
  path.basename(filename, path.extname(filename)).replace(/[_-]+/g, " ").trim();

export const discardStagedBookFile = async (file: StagedBookFile) => {
  await rm(bookDirectory(file.bookId), { recursive: true, force: true });
};

export const stageBookFile = async (
  source: Readable & { truncated?: boolean },
  sourceFilename: string,
): Promise<StagedBookFile> => {
  const bookId = randomUUID();
  const targetDir = bookDirectory(bookId);
  const filePath = path.join(targetDir, "original.epub");
  const hash = createHash("sha256");
  let fileSizeBytes = 0;

  await mkdir(targetDir, { recursive: true });

  try {
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        fileSizeBytes += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    await pipeline(source, meter, createWriteStream(filePath, { flags: "wx" }));
    if (source.truncated || fileSizeBytes > MAX_EPUB_FILE_BYTES) {
      throw new AppError(413, `EPUB files must be ${MAX_EPUB_FILE_BYTES / (1024 * 1024)} MB or smaller.`);
    }

    return {
      bookId,
      fileHash: hash.digest("hex"),
      filePath,
      fileSizeBytes,
      sourceFilename,
    };
  } catch (error) {
    await rm(targetDir, { recursive: true, force: true });
    if (error instanceof AppError) throw error;
    throw new AppError(500, "The EPUB upload could not be saved.");
  }
};

const resolveImportBookshelves = (bookshelfIds?: string | string[] | null) => {
  const rawIds = Array.isArray(bookshelfIds) ? bookshelfIds : [bookshelfIds];
  const uniqueIds = Array.from(new Set(rawIds.map((id) => id?.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    return [getFirstBookshelfRecord()];
  }

  return uniqueIds.map((bookshelfId) => resolveBookshelfRecord(bookshelfId));
};

const formatBookshelfList = (names: string[]) => {
  if (names.length <= 1) return names[0] ?? "your bookshelf";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
};

const normalizeRating = (rating: number | null) => {
  if (rating === null) return null;
  return Number.isInteger(rating * 2) && rating >= 0.5 && rating <= 5 ? rating : null;
};

const toBookSummary = (book: BookRecord, bookshelves: BookshelfSummary[]): BookSummary => ({
  id: book.id,
  title: book.title,
  author: book.author,
  sourceFilename: book.sourceFilename,
  fileSizeBytes: book.fileSizeBytes,
  importedAt: book.importedAt.toISOString(),
  coverUrl: book.coverPath ? `/api/books/${book.id}/cover` : null,
  readStatus: book.readStatus,
  rating: normalizeRating(book.rating),
  bookshelves,
});

export const serializeBook = (book: BookRecord): BookSummary =>
  toBookSummary(book, listBookshelvesForBook(book.id));

/** Serialize a whole page of books without re-querying memberships per book. */
const serializeBooks = (rows: BookRecord[]): BookSummary[] => {
  const bookshelvesByBook = listBookshelvesForBooks(rows.map((row) => row.id));
  return rows.map((row) => toBookSummary(row, bookshelvesByBook.get(row.id) ?? []));
};

// LIKE reads % and _ as wildcards, so searching for "100%" or "a_b" would match
// far more than the reader typed. Escape those and the escape character itself,
// then tell SQLite which character is doing the escaping.
const escapeLikePattern = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const containsText = (column: SQLiteColumn, value: string) =>
  sql`${column} like ${`%${escapeLikePattern(value)}%`} escape '\\'`;

const bookSelection = {
  id: books.id,
  title: books.title,
  author: books.author,
  filePath: books.filePath,
  coverPath: books.coverPath,
  fileHash: books.fileHash,
  sourceFilename: books.sourceFilename,
  fileSizeBytes: books.fileSizeBytes,
  importedAt: books.importedAt,
  readStatus: books.readStatus,
  rating: books.rating,
};

const getBookSortOrder = (sort: BookSortKey, direction: SortDirection) => {
  let expression: SQLiteColumn | SQL;
  switch (sort) {
    case "title":
      expression = sql`lower(${books.title})`;
      break;
    case "author":
      expression = sql`lower(${books.author})`;
      break;
    case "sourceFilename":
      expression = sql`lower(${books.sourceFilename})`;
      break;
    case "fileSizeBytes":
      expression = books.fileSizeBytes;
      break;
    case "readStatus":
      expression = sql<number>`case ${books.readStatus}
        when 'unread' then 0
        when 'reading' then 1
        when 'finished' then 2
        else 3
      end`;
      break;
    case "rating":
      expression = sql<number>`coalesce(${books.rating}, 0)`;
      break;
    // "importedAt" and anything unrecognized land here.
    default:
      expression = books.importedAt;
      break;
  }

  return direction === "asc" ? asc(expression) : desc(expression);
};

const countBooks = (bookshelfId: string | null, whereClause?: SQL) => {
  if (bookshelfId) {
    return (
      db
        .select({ value: count() })
        .from(books)
        .innerJoin(bookShelves, eq(bookShelves.bookId, books.id))
        .where(and(eq(bookShelves.bookshelfId, bookshelfId), whereClause))
        .get()?.value ?? 0
    );
  }

  return (
    (whereClause
      ? db.select({ value: count() }).from(books).where(whereClause).get()
      : db.select({ value: count() }).from(books).get()
    )?.value ?? 0
  );
};

const countBooksByStatus = (
  bookshelfId: string | null,
  searchClause?: SQL,
): Record<ReadStatus | "all", number> => {
  const rows = bookshelfId
    ? db
        .select({ readStatus: books.readStatus, value: count() })
        .from(books)
        .innerJoin(bookShelves, eq(bookShelves.bookId, books.id))
        .where(and(eq(bookShelves.bookshelfId, bookshelfId), searchClause))
        .groupBy(books.readStatus)
        .all()
    : searchClause
      ? db
          .select({ readStatus: books.readStatus, value: count() })
          .from(books)
          .where(searchClause)
          .groupBy(books.readStatus)
          .all()
      : db
          .select({ readStatus: books.readStatus, value: count() })
          .from(books)
          .groupBy(books.readStatus)
          .all();

  const counts: Record<ReadStatus | "all", number> = {
    all: 0,
    unread: 0,
    reading: 0,
    finished: 0,
  };
  for (const row of rows) {
    counts[row.readStatus] = row.value;
    counts.all += row.value;
  }
  return counts;
};

export const listBooks = (options: BookListOptions = {}): BookPage => {
  const query = options.query?.trim() ?? "";
  const bookshelfId = options.bookshelfId?.trim() || null;
  const readStatus = options.readStatus ?? null;
  const sort = options.sort ?? "importedAt";
  const direction = options.direction ?? "desc";
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(
    MAX_BOOKS_PAGE_SIZE,
    Math.max(1, options.limit ?? BOOKS_PAGE_SIZE),
  );

  if (bookshelfId) {
    resolveBookshelfRecord(bookshelfId);
  }

  const searchClause = query
    ? or(
        containsText(books.title, query),
        containsText(books.author, query),
        containsText(books.sourceFilename, query),
      )
    : undefined;
  const pageClause = and(searchClause, readStatus ? eq(books.readStatus, readStatus) : undefined);
  const order = getBookSortOrder(sort, direction);

  const rows = bookshelfId
    ? db
        .select(bookSelection)
        .from(books)
        .innerJoin(bookShelves, eq(bookShelves.bookId, books.id))
        .where(and(eq(bookShelves.bookshelfId, bookshelfId), pageClause))
        .orderBy(order, asc(books.id))
        .limit(limit)
        .offset(offset)
        .all()
    : pageClause
      ? db
          .select(bookSelection)
          .from(books)
          .where(pageClause)
          .orderBy(order, asc(books.id))
          .limit(limit)
          .offset(offset)
          .all()
      : db
          .select(bookSelection)
          .from(books)
          .orderBy(order, asc(books.id))
          .limit(limit)
          .offset(offset)
          .all();

  const statusCounts = countBooksByStatus(bookshelfId, searchClause);
  return {
    books: serializeBooks(rows),
    offset,
    limit,
    total: readStatus ? statusCounts[readStatus] : statusCounts.all,
    unfilteredTotal: query ? countBooks(bookshelfId) : statusCounts.all,
    statusCounts,
  };
};

export const getBook = (bookId: string): BookDetail => {
  const row = db.select().from(books).where(eq(books.id, bookId)).get();
  if (!row) {
    throw new AppError(404, "Book not found.");
  }

  return serializeBook(row);
};

export const getBookRecord = (bookId: string) => {
  const row = db.select().from(books).where(eq(books.id, bookId)).get();
  if (!row) {
    throw new AppError(404, "Book not found.");
  }
  return row;
};

export const updateBookMetadata = (
  bookId: string,
  metadata: UpdateBookMetadataPayload,
): BookDetail => {
  const current = getBookRecord(bookId);

  db.update(books)
    .set({
      readStatus: metadata.readStatus ?? current.readStatus,
      rating: metadata.rating === undefined ? current.rating : metadata.rating,
    })
    .where(eq(books.id, bookId))
    .run();

  return getBook(bookId);
};

const loadPreparedBookReader = async (bookId: string): Promise<PreparedBookReader> => {
  const book = getBookRecord(bookId);
  return prepareEpubReader(book.filePath, readerDirectory(bookId), bookId);
};

const getPreparedBookReader = (bookId: string): Promise<PreparedBookReader> => {
  const existing = preparedReaderRequests.get(bookId);
  if (existing) {
    return existing;
  }

  const request = loadPreparedBookReader(bookId).catch((error) => {
    preparedReaderRequests.delete(bookId);
    throw error;
  });

  preparedReaderRequests.set(bookId, request);
  return request;
};

export const getBookReader = async (bookId: string): Promise<BookReader> => {
  const manifest = await getPreparedBookReader(bookId);
  return {
    id: bookId,
    title: manifest.title,
    author: manifest.author,
    sections: manifest.sections,
  };
};

export const readBookReaderAsset = async (bookId: string, assetPath: string) => {
  const book = getBookRecord(bookId);
  const bytes = await readEpubReaderAsset(book.filePath, assetPath);

  if (!bytes) {
    throw new AppError(404, "Reader asset not found.");
  }

  return bytes;
};

export const deleteBook = async (bookId: string): Promise<DeleteBookResult> => {
  const book = getBookRecord(bookId);
  const sourceDir = bookDirectory(book.id);
  const trashRoot = trashDirectory();
  const trashDir = path.join(trashRoot, `${book.id}-${Date.now()}`);
  let movedToTrash = false;

  preparedReaderRequests.delete(book.id);

  try {
    await mkdir(trashRoot, { recursive: true });
    await rename(sourceDir, trashDir);
    movedToTrash = true;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw new AppError(500, "The book files could not be prepared for deletion.");
    }
  }

  try {
    db.transaction((tx) => {
      tx.delete(deliveries).where(eq(deliveries.bookId, book.id)).run();
      tx.delete(bookShelves).where(eq(bookShelves.bookId, book.id)).run();
      tx.delete(books).where(eq(books.id, book.id)).run();
    });
  } catch (error) {
    // The transaction rolled back every row it touched, so only the filesystem
    // move needs undoing.
    if (movedToTrash) {
      await rename(trashDir, sourceDir).catch((restoreError) => {
        console.error("Failed to restore book files after delete rollback.", restoreError);
      });
    }

    console.error("Failed to delete book record.", error);
    throw new AppError(500, "The book could not be deleted.");
  }

  if (movedToTrash) {
    // A failure here only strands the directory; the startup trash sweep removes it.
    await rm(trashDir, { recursive: true, force: true }).catch((cleanupError) => {
      console.error("Book record deleted but filesystem cleanup failed.", cleanupError);
    });
  }

  return {
    id: book.id,
    title: book.title,
    message: `${book.title} was deleted from your library.`,
  };
};

export const importBookFile = async (
  file: StagedBookFile,
  bookshelfIds?: string | string[] | null,
): Promise<ImportResult> => {
  const targetBookshelves = resolveImportBookshelves(bookshelfIds);
  const targetBookshelfNames = targetBookshelves.map((bookshelf) => bookshelf.name);
  const { bookId, fileHash, filePath, fileSizeBytes, sourceFilename } = file;
  const targetDir = bookDirectory(bookId);

  if (!sourceFilename.toLowerCase().endsWith(".epub")) {
    await discardStagedBookFile(file);
    return {
      status: "failed",
      message: `${sourceFilename} is not an EPUB file.`,
    };
  }

  const duplicateResult = async (existing: BookRecord): Promise<ImportResult> => {
    for (const bookshelf of targetBookshelves) {
      addBookToBookshelf(existing.id, bookshelf.id);
    }
    await discardStagedBookFile(file);
    return {
      status: "duplicate",
      message: `${sourceFilename} is already in your library and is now on ${formatBookshelfList(targetBookshelfNames)}.`,
      book: serializeBook(existing),
    };
  };

  let coverPath: string | null = null;

  try {
    const existing = db.select().from(books).where(eq(books.fileHash, fileHash)).get();
    if (existing) {
      return await duplicateResult(existing);
    }

    const metadata = await extractEpubMetadata(filePath);
    const title = metadata.title ?? (fallbackTitle(sourceFilename) || "Untitled Book");
    const author = metadata.author ?? "Unknown Author";

    if (metadata.coverBuffer && metadata.coverExtension) {
      coverPath = path.join(targetDir, `cover${metadata.coverExtension}`);
      await writeFile(coverPath, metadata.coverBuffer);
    }

    const importedAt = new Date();

    db.insert(books)
      .values({
        id: bookId,
        title,
        author,
        filePath,
        coverPath,
        fileHash,
        sourceFilename,
        fileSizeBytes,
        importedAt,
      })
      .onConflictDoNothing({ target: books.fileHash })
      .run();

    const created = db.select().from(books).where(eq(books.id, bookId)).get();
    if (!created) {
      const duplicate = db.select().from(books).where(eq(books.fileHash, fileHash)).get();
      if (duplicate) {
        return await duplicateResult(duplicate);
      }
      throw new AppError(500, "The book could not be recorded.");
    }

    for (const bookshelf of targetBookshelves) {
      addBookToBookshelf(bookId, bookshelf.id);
    }

    queueBookSearchIndex(bookId);

    return {
      status: "imported",
      message: `${title} was added to your library.`,
      book: serializeBook(created),
    };
  } catch (error) {
    await rm(targetDir, { recursive: true, force: true });
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, "The EPUB could not be saved.");
  }
};
