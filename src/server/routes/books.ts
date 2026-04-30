import { access, readFile } from "node:fs/promises";

import { Hono } from "hono";
import { z } from "zod";

import { AppError, errorMessage } from "../errors";
import { coverContentType, readerAssetContentType } from "../lib/storage";
import {
  deleteBook,
  getBook,
  getBookReader,
  getBookReaderAssetPath,
  getBookRecord,
  importBookFile,
  listBooks,
} from "../services/books";
import { listDeliveriesForBook, sendBookToKindle } from "../services/delivery";

const sendSchema = z.object({
  recipientEmail: z.string().trim().email().nullish(),
});

const routeError = (error: unknown) => {
  if (error instanceof AppError) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (error instanceof z.ZodError) {
    return new Response(JSON.stringify({ error: error.issues[0]?.message ?? "Invalid request." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.error(error);
  return new Response(JSON.stringify({ error: errorMessage(error) }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
};

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
  return c.json({ books: listBooks(query) });
});

booksRoutes.post("/import", async (c) => {
  try {
    const formData = await c.req.formData();
    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

    if (files.length === 0) {
      throw new AppError(400, "Choose at least one EPUB file to import.");
    }

    const results = [];
    for (const file of files) {
      results.push(await importBookFile(file));
    }

    return c.json({ results });
  } catch (error) {
    return routeError(error);
  }
});

booksRoutes.delete("/:id", async (c) => {
  try {
    return c.json({ deletion: await deleteBook(c.req.param("id")) });
  } catch (error) {
    return routeError(error);
  }
});

booksRoutes.get("/:id/cover", async (c) => {
  try {
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
  } catch (error) {
    return routeError(error);
  }
});

booksRoutes.get("/:id/read", async (c) => {
  try {
    return c.json({ reader: await getBookReader(c.req.param("id")) });
  } catch (error) {
    return routeError(error);
  }
});

booksRoutes.get("/:id/read/*", async (c) => {
  try {
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
  } catch (error) {
    return routeError(error);
  }
});

booksRoutes.get("/:id/deliveries", (c) => {
  try {
    return c.json({ deliveries: listDeliveriesForBook(c.req.param("id")) });
  } catch (error) {
    return routeError(error);
  }
});

booksRoutes.get("/:id", (c) => {
  try {
    return c.json({ book: getBook(c.req.param("id")) });
  } catch (error) {
    return routeError(error);
  }
});

booksRoutes.post("/:id/send", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const payload = sendSchema.parse(body);
    const delivery = await sendBookToKindle(c.req.param("id"), payload.recipientEmail ?? null);
    return c.json({ delivery });
  } catch (error) {
    return routeError(error);
  }
});
