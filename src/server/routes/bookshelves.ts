import { Hono } from "hono";
import { z } from "zod";

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

export const bookshelvesRoutes = new Hono();

bookshelvesRoutes.get("/", (c) => c.json({ bookshelves: listBookshelves() }));

bookshelvesRoutes.post("/", async (c) => {
  const payload = bookshelfSchema.parse(await c.req.json());
  return c.json({ bookshelf: createBookshelf(payload) });
});

bookshelvesRoutes.put("/:id", async (c) => {
  const payload = bookshelfSchema.parse(await c.req.json());
  return c.json({ bookshelf: updateBookshelf(c.req.param("id"), payload) });
});

bookshelvesRoutes.delete("/:id", (c) =>
  c.json({ deletion: deleteBookshelf(c.req.param("id")) }),
);

bookshelvesRoutes.post("/:id/books", async (c) => {
  const payload = bookMembershipSchema.parse(await c.req.json());
  addBookToBookshelf(payload.bookId, c.req.param("id"));
  return c.json({ bookshelves: listBookshelves() });
});

bookshelvesRoutes.delete("/:id/books/:bookId", (c) => {
  removeBookFromBookshelf(c.req.param("bookId"), c.req.param("id"));
  return c.json({ bookshelves: listBookshelves() });
});
