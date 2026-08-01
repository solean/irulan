import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, desc, eq, like, or } from "drizzle-orm";

import {
  BookDetail,
  BookReader,
  BookshelfSummary,
  BookSummary,
  DeleteBookResult,
  ImportResult,
  type UpdateBookMetadataPayload,
} from "../../shared/types";
import { appConfig } from "../config";
import { db, persistDatabase } from "../db/client";
import { books, bookShelves, deliveries } from "../db/schema";
import { AppError } from "../errors";
import { bookDirectory, readerDirectory } from "../lib/storage";
import { extractEpubMetadata, prepareEpubReader, resolveEpubReaderAssetPath } from "./epub";
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

const fallbackTitle = (filename: string) =>
  path.basename(filename, path.extname(filename)).replace(/[_-]+/g, " ").trim();

const hashStoredFile = async (filePath: string) => {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
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

export const listBooks = (searchTerm?: string, bookshelfId?: string | null): BookSummary[] => {
  const trimmed = searchTerm?.trim();
  const searchClause = trimmed
    ? or(
        like(books.title, `%${trimmed}%`),
        like(books.author, `%${trimmed}%`),
        like(books.sourceFilename, `%${trimmed}%`),
      )
    : undefined;

  if (bookshelfId?.trim()) {
    resolveBookshelfRecord(bookshelfId);
    const rows = db
      .select({
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
      })
      .from(books)
      .innerJoin(bookShelves, eq(bookShelves.bookId, books.id))
      .where(
        searchClause
          ? and(eq(bookShelves.bookshelfId, bookshelfId.trim()), searchClause)
          : eq(bookShelves.bookshelfId, bookshelfId.trim()),
      )
      .orderBy(desc(books.importedAt))
      .all();

    return serializeBooks(rows);
  }

  const rows = searchClause
    ? db
        .select()
        .from(books)
        .where(searchClause)
        .orderBy(desc(books.importedAt))
        .all()
    : db.select().from(books).orderBy(desc(books.importedAt)).all();

  return serializeBooks(rows);
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
  persistDatabase();

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

export const getBookReaderAssetPath = async (bookId: string, assetPath: string) => {
  await getPreparedBookReader(bookId);
  return resolveEpubReaderAssetPath(readerDirectory(bookId), assetPath);
};

export const deleteBook = async (bookId: string): Promise<DeleteBookResult> => {
  const book = getBookRecord(bookId);
  const sourceDir = bookDirectory(book.id);
  const trashRoot = path.join(appConfig.storageDir, ".trash");
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
    persistDatabase();
  } catch (error) {
    // The transaction rolled back every row it touched, so the in-memory database
    // already matches what is on disk. Only the filesystem move needs undoing.
    if (movedToTrash) {
      await rename(trashDir, sourceDir).catch((restoreError) => {
        console.error("Failed to restore book files after delete rollback.", restoreError);
      });
    }

    console.error("Failed to delete book record.", error);
    throw new AppError(500, "The book could not be deleted.");
  }

  if (movedToTrash) {
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
  file: File,
  bookshelfIds?: string | string[] | null,
): Promise<ImportResult> => {
  const targetBookshelves = resolveImportBookshelves(bookshelfIds);
  const targetBookshelfNames = targetBookshelves.map((bookshelf) => bookshelf.name);

  if (!file.name.toLowerCase().endsWith(".epub")) {
    return {
      status: "failed",
      message: `${file.name} is not an EPUB file.`,
    };
  }

  const bookId = randomUUID();
  const targetDir = bookDirectory(bookId);
  const sourceFilename = file.name;
  const filePath = path.join(targetDir, "original.epub");
  let coverPath: string | null = null;

  await mkdir(targetDir, { recursive: true });

  try {
    await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

    const fileHash = await hashStoredFile(filePath);
    const existing = db.select().from(books).where(eq(books.fileHash, fileHash)).get();
    if (existing) {
      for (const bookshelf of targetBookshelves) {
        addBookToBookshelf(existing.id, bookshelf.id);
      }
      await rm(targetDir, { recursive: true, force: true });
      return {
        status: "duplicate",
        message: `${file.name} is already in your library and is now on ${formatBookshelfList(targetBookshelfNames)}.`,
        book: serializeBook(existing),
      };
    }

    const metadata = await extractEpubMetadata(await readFile(filePath));
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
        fileSizeBytes: file.size,
        importedAt,
      })
      .run();
    for (const bookshelf of targetBookshelves) {
      addBookToBookshelf(bookId, bookshelf.id);
    }
    persistDatabase();

    const created = db.select().from(books).where(eq(books.id, bookId)).get();
    if (!created) {
      throw new AppError(500, "The book was imported but could not be reloaded.");
    }

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
