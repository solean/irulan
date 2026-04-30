import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { desc, eq, like, or } from "drizzle-orm";

import { BookDetail, BookReader, BookSummary, DeleteBookResult, ImportResult } from "../../shared/types";
import { appConfig } from "../config";
import { db, persistDatabase } from "../db/client";
import { books, deliveries } from "../db/schema";
import { AppError } from "../errors";
import { bookDirectory, readerDirectory } from "../lib/storage";
import { extractEpubMetadata, prepareEpubReader, resolveEpubReaderAssetPath } from "./epub";

type BookRecord = typeof books.$inferSelect;
type DeliveryRecord = typeof deliveries.$inferSelect;
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

export const serializeBook = (book: BookRecord): BookSummary => ({
  id: book.id,
  title: book.title,
  author: book.author,
  sourceFilename: book.sourceFilename,
  fileSizeBytes: book.fileSizeBytes,
  importedAt: book.importedAt.toISOString(),
  coverUrl: book.coverPath ? `/api/books/${book.id}/cover` : null,
});

export const listBooks = (searchTerm?: string): BookSummary[] => {
  const trimmed = searchTerm?.trim();

  const query = db.select().from(books);
  const rows = trimmed
    ? query
        .where(
          or(
            like(books.title, `%${trimmed}%`),
            like(books.author, `%${trimmed}%`),
            like(books.sourceFilename, `%${trimmed}%`),
          ),
        )
        .orderBy(desc(books.importedAt))
        .all()
    : query.orderBy(desc(books.importedAt)).all();

  return rows.map(serializeBook);
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
  const bookDeliveries: DeliveryRecord[] = db
    .select()
    .from(deliveries)
    .where(eq(deliveries.bookId, book.id))
    .all();
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
    db.delete(deliveries).where(eq(deliveries.bookId, book.id)).run();
    db.delete(books).where(eq(books.id, book.id)).run();
    persistDatabase();
  } catch (error) {
    if (movedToTrash) {
      await rename(trashDir, sourceDir).catch((restoreError) => {
        console.error("Failed to restore book after delete rollback.", restoreError);
      });
    }

    if (bookDeliveries.length > 0) {
      db.insert(deliveries).values(bookDeliveries).run();
    }
    persistDatabase();

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

export const importBookFile = async (file: File): Promise<ImportResult> => {
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
      await rm(targetDir, { recursive: true, force: true });
      return {
        status: "duplicate",
        message: `${file.name} is already in your library.`,
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
