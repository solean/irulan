import { access, readFile } from "node:fs/promises";

import { Hono } from "hono";
import { z } from "zod";

import { READ_STATUSES } from "../../shared/types";
import { AppError } from "../errors";
import { coverContentType, readerAssetContentType } from "../lib/storage";
import {
  deleteBook,
  getBook,
  getBookReader,
  getBookReaderAssetPath,
  getBookRecord,
  importBookFile,
  listBooks,
  updateBookMetadata,
} from "../services/books";
import { replaceBookBookshelves } from "../services/bookshelves";
import { listDeliveriesForBook, sendBookToKindle } from "../services/delivery";

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

const getReaderAssetRequestPath = (requestPath: string, bookId: string) => {
  const prefix = `/api/books/${bookId}/read/`;
  if (!requestPath.startsWith(prefix)) {
    throw new AppError(400, "Invalid reader asset path.");
  }

  return decodeURIComponent(requestPath.slice(prefix.length));
};

booksRoutes.get("/", (c) => {
  const query = c.req.query("q") ?? "";
  const bookshelfId = c.req.query("bookshelfId") ?? null;
  return c.json({ books: listBooks(query, bookshelfId === "all" ? null : bookshelfId) });
});

booksRoutes.post("/import", async (c) => {
  const formData = await c.req.formData();
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  const bookshelfIds = new URL(c.req.url).searchParams.getAll("bookshelfId");

  if (files.length === 0) {
    throw new AppError(400, "Choose at least one EPUB file to import.");
  }

  const results = [];
  for (const file of files) {
    results.push(await importBookFile(file, bookshelfIds));
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
  const filePath = await getBookReaderAssetPath(bookId, assetPath);

  if (!(await access(filePath).then(() => true).catch(() => false))) {
    throw new AppError(404, "Reader asset not found.");
  }

  const bytes = await readFile(filePath);
  return new Response(bytes, {
    headers: {
      "Content-Type": readerAssetContentType(filePath),
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
