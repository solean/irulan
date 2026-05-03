import { Hono } from "hono";
import { z } from "zod";

import { AppError, errorMessage } from "../errors";
import {
  addBookToBookshelf,
  createBookshelf,
  deleteBookshelf,
  listBookshelves,
  removeBookFromBookshelf,
  updateBookshelf,
} from "../services/bookshelves";

const bookshelfSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kindleEmail: z.string().trim().email().or(z.literal("")).nullable().optional(),
});

const bookMembershipSchema = z.object({
  bookId: z.string().trim().min(1),
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

export const bookshelvesRoutes = new Hono();

bookshelvesRoutes.get("/", (c) => c.json({ bookshelves: listBookshelves() }));

bookshelvesRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const payload = bookshelfSchema.parse(body);
    return c.json({ bookshelf: createBookshelf(payload) });
  } catch (error) {
    return routeError(error);
  }
});

bookshelvesRoutes.put("/:id", async (c) => {
  try {
    const body = await c.req.json();
    const payload = bookshelfSchema.parse(body);
    return c.json({ bookshelf: updateBookshelf(c.req.param("id"), payload) });
  } catch (error) {
    return routeError(error);
  }
});

bookshelvesRoutes.delete("/:id", (c) => {
  try {
    return c.json({ deletion: deleteBookshelf(c.req.param("id")) });
  } catch (error) {
    return routeError(error);
  }
});

bookshelvesRoutes.post("/:id/books", async (c) => {
  try {
    const body = await c.req.json();
    const payload = bookMembershipSchema.parse(body);
    addBookToBookshelf(payload.bookId, c.req.param("id"));
    return c.json({ bookshelves: listBookshelves() });
  } catch (error) {
    return routeError(error);
  }
});

bookshelvesRoutes.delete("/:id/books/:bookId", (c) => {
  try {
    removeBookFromBookshelf(c.req.param("bookId"), c.req.param("id"));
    return c.json({ bookshelves: listBookshelves() });
  } catch (error) {
    return routeError(error);
  }
});
