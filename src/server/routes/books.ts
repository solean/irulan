import { readFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import busboy, { type Busboy } from "busboy";
import { Hono } from "hono";
import { z } from "zod";
import {
  BOOK_SORT_KEYS,
  BOOKS_PAGE_SIZE,
  MAX_BOOKS_PAGE_SIZE,
  READ_STATUSES,
  SORT_DIRECTIONS,
} from "../../shared/types";
import { AppError } from "../errors";
import { coverContentType, readerAssetContentType } from "../lib/storage";
import {
  deleteBook,
  discardStagedBookFile,
  getBook,
  getBookReader,
  getBookRecord,
  importBookFile,
  listBooks,
  MAX_EPUB_FILE_BYTES,
  readBookReaderAsset,
  stageBookFile,
  type StagedBookFile,
  updateBookMetadata,
} from "../services/books";
import { replaceBookBookshelves } from "../services/bookshelves";
import { listDeliveriesForBook, sendBookToKindle } from "../services/delivery";

const listBooksQuerySchema = z.object({
  q: z.string().default(""),
  bookshelfId: z.string().trim().optional(),
  readStatus: z.enum(READ_STATUSES).optional(),
  sort: z.enum(BOOK_SORT_KEYS).default("importedAt"),
  direction: z.enum(SORT_DIRECTIONS).default("desc"),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_BOOKS_PAGE_SIZE)
    .default(BOOKS_PAGE_SIZE),
});

const sendSchema = z.object({
  bookshelfId: z.string().trim().min(1).nullish(),
  recipientEmail: z.string().trim().email().nullish(),
});

const bookBookshelvesSchema = z.object({
  bookshelfIds: z.array(z.string().trim().min(1)).min(1),
});

const bookMetadataSchema = z.object({
  readStatus: z.enum(READ_STATUSES).optional(),
  rating: z
    .number()
    .min(0.5)
    .max(5)
    .refine((value) => Number.isInteger(value * 2), "Rating must use half-star increments.")
    .nullable()
    .optional(),
});

export const booksRoutes = new Hono();
const MAX_IMPORT_REQUEST_BYTES = 1024 * 1024 * 1024;
const MAX_IMPORT_FILES = 20;

type StagingOutcome =
  | { file: StagedBookFile; error?: never }
  | { file?: never; error: unknown };

const discardStagedBookFiles = async (files: StagedBookFile[]) => {
  await Promise.all(files.map((file) => discardStagedBookFile(file)));
};

const parseStagedBookFiles = async (request: Request) => {
  if (!request.body) {
    throw new AppError(400, "Choose at least one EPUB file to import.");
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_REQUEST_BYTES) {
    throw new AppError(413, "The import request is too large.");
  }

  let multipart: Busboy;
  try {
    multipart = busboy({
      headers: Object.fromEntries(request.headers),
      limits: {
        fileSize: MAX_EPUB_FILE_BYTES,
        files: MAX_IMPORT_FILES,
        fields: 10,
        parts: MAX_IMPORT_FILES + 10,
      },
    });
  } catch {
    throw new AppError(400, "The import must use multipart form data.");
  }

  const staging: Array<Promise<StagingOutcome>> = [];
  let limitError: AppError | null = null;

  multipart.on("file", (fieldName, stream, info) => {
    if (fieldName !== "files") {
      stream.resume();
      return;
    }

    staging.push(
      stageBookFile(stream, info.filename || "unnamed.epub").then(
        (file) => ({ file }),
        (error: unknown) => ({ error }),
      ),
    );
  });
  multipart.once("filesLimit", () => {
    limitError = new AppError(413, `Import at most ${MAX_IMPORT_FILES} EPUB files at once.`);
  });
  multipart.once("fieldsLimit", () => {
    limitError = new AppError(413, "The import contains too many form fields.");
  });
  multipart.once("partsLimit", () => {
    limitError = new AppError(413, "The import contains too many multipart sections.");
  });

  let requestBytes = 0;
  const requestLimit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      requestBytes += chunk.length;
      if (requestBytes > MAX_IMPORT_REQUEST_BYTES) {
        callback(new AppError(413, "The import request is too large."));
        return;
      }
      callback(null, chunk);
    },
  });

  let parsingError: unknown = null;
  try {
    await pipeline(Readable.from(request.body), requestLimit, multipart);
  } catch (error) {
    parsingError = error;
  }

  const outcomes = await Promise.all(staging);
  const files = outcomes.flatMap((outcome) => (outcome.file ? [outcome.file] : []));
  const stagingError = outcomes.find((outcome) => outcome.error)?.error;
  const error = parsingError ?? limitError ?? stagingError;
  if (error) {
    await discardStagedBookFiles(files);
    if (error instanceof AppError) throw error;
    throw new AppError(400, "The multipart import could not be read.");
  }

  return files;
};


const getReaderAssetRequestPath = (requestPath: string, bookId: string) => {
  const prefix = `/api/books/${bookId}/read/`;
  if (!requestPath.startsWith(prefix)) {
    throw new AppError(400, "Invalid reader asset path.");
  }

  return decodeURIComponent(requestPath.slice(prefix.length));
};

booksRoutes.get("/", (c) => {
  const query = listBooksQuerySchema.parse(c.req.query());
  return c.json(
    listBooks({
      query: query.q,
      bookshelfId:
        !query.bookshelfId || query.bookshelfId === "all" ? null : query.bookshelfId,
      readStatus: query.readStatus,
      sort: query.sort,
      direction: query.direction,
      offset: query.offset,
      limit: query.limit,
    }),
  );
});

booksRoutes.post("/import", async (c) => {
  const files = await parseStagedBookFiles(c.req.raw);
  const bookshelfIds = new URL(c.req.url).searchParams.getAll("bookshelfId");

  if (files.length === 0) {
    throw new AppError(400, "Choose at least one EPUB file to import.");
  }

  const pending = new Set(files);
  const results = [];
  try {
    for (const file of files) {
      pending.delete(file);
      results.push(await importBookFile(file, bookshelfIds));
    }
  } finally {
    await discardStagedBookFiles([...pending]);
  }

  return c.json({ results });
});

booksRoutes.delete("/:id", async (c) =>
  c.json({ deletion: await deleteBook(c.req.param("id")) }),
);

booksRoutes.get("/:id/cover", async (c) => {
  const book = getBookRecord(c.req.param("id"));
  if (!book.coverPath) {
    throw new AppError(404, "This book does not have a cover image.");
  }

  const bytes = await readFile(book.coverPath);
  return new Response(bytes, {
    headers: {
      "Content-Type": coverContentType(book.coverPath),
      "Cache-Control": "public, max-age=3600",
    },
  });
});

booksRoutes.get("/:id/read", async (c) =>
  c.json({ reader: await getBookReader(c.req.param("id")) }),
);

booksRoutes.get("/:id/read/*", async (c) => {
  const bookId = c.req.param("id");
  const assetPath = getReaderAssetRequestPath(c.req.path, bookId);
  const bytes = await readBookReaderAsset(bookId, assetPath);

  return new Response(bytes, {
    headers: {
      "Content-Type": readerAssetContentType(assetPath),
      "Cache-Control": "public, max-age=3600",
    },
  });
});

booksRoutes.get("/:id/deliveries", (c) =>
  c.json({ deliveries: listDeliveriesForBook(c.req.param("id")) }),
);

booksRoutes.put("/:id/bookshelves", async (c) => {
  const payload = bookBookshelvesSchema.parse(await c.req.json());
  replaceBookBookshelves(c.req.param("id"), payload.bookshelfIds);
  return c.json({ book: getBook(c.req.param("id")) });
});

booksRoutes.patch("/:id/metadata", async (c) => {
  const payload = bookMetadataSchema.parse(await c.req.json());
  return c.json({ book: updateBookMetadata(c.req.param("id"), payload) });
});

booksRoutes.get("/:id", (c) => c.json({ book: getBook(c.req.param("id")) }));

booksRoutes.post("/:id/send", async (c) => {
  const payload = sendSchema.parse(await c.req.json().catch(() => ({})));
  const delivery = await sendBookToKindle(c.req.param("id"), {
    bookshelfId: payload.bookshelfId ?? null,
    recipientEmail: payload.recipientEmail ?? null,
  });
  return c.json({ delivery });
});
