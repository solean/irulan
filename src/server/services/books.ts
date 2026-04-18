import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { desc, eq, like, or } from "drizzle-orm";

import { BookDetail, BookReader, BookSummary, ImportResult } from "../../shared/types";
import { db } from "../db/client";
import { books } from "../db/schema";
import { AppError } from "../errors";
import { bookDirectory, readerDirectory } from "../lib/storage";
import { extractEpubMetadata, prepareEpubReader, resolveEpubReaderAssetPath } from "./epub";

type BookRecord = typeof books.$inferSelect;

const readerManifestRequests = new Map<string, Promise<BookReader>>();

const fallbackTitle = (filename: string) =>
  path.basename(filename, path.extname(filename)).replace(/[_-]+/g, " ").trim();

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

const loadBookReader = async (book: BookRecord): Promise<BookReader> => {
  const manifest = await prepareEpubReader(book.filePath, readerDirectory(book.id), book.id);
  return {
    id: book.id,
    title: manifest.title,
    author: manifest.author,
    sections: manifest.sections,
  };
};

export const getBookReader = async (bookId: string): Promise<BookReader> => {
  const book = getBookRecord(bookId);
  const existing = readerManifestRequests.get(bookId);
  if (existing) {
    return existing;
  }

  const request = loadBookReader(book).finally(() => {
    readerManifestRequests.delete(bookId);
  });

  readerManifestRequests.set(bookId, request);
  return request;
};

export const getBookReaderAssetPath = async (bookId: string, assetPath: string) => {
  const book = getBookRecord(bookId);
  await getBookReader(bookId);
  return resolveEpubReaderAssetPath(readerDirectory(book.id), assetPath);
};

export const importBookFile = async (file: File): Promise<ImportResult> => {
  if (!file.name.toLowerCase().endsWith(".epub")) {
    return {
      status: "failed",
      message: `${file.name} is not an EPUB file.`,
    };
  }

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(fileBytes).digest("hex");

  const existing = db.select().from(books).where(eq(books.fileHash, fileHash)).get();
  if (existing) {
    return {
      status: "duplicate",
      message: `${file.name} is already in your library.`,
      book: serializeBook(existing),
    };
  }

  const metadata = await extractEpubMetadata(fileBytes);
  const bookId = crypto.randomUUID();
  const targetDir = bookDirectory(bookId);
  const sourceFilename = file.name;
  const title = metadata.title ?? (fallbackTitle(sourceFilename) || "Untitled Book");
  const author = metadata.author ?? "Unknown Author";
  const filePath = path.join(targetDir, "original.epub");
  let coverPath: string | null = null;

  await mkdir(targetDir, { recursive: true });

  try {
    await writeFile(filePath, fileBytes);

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
