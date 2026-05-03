import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const bookshelves = sqliteTable(
  "bookshelves",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kindleEmail: text("kindle_email"),
    sortOrder: integer("sort_order").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("bookshelves_sort_order_idx").on(table.sortOrder)],
);

export const books = sqliteTable(
  "books",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    author: text("author").notNull(),
    filePath: text("file_path").notNull(),
    coverPath: text("cover_path"),
    fileHash: text("file_hash").notNull().unique(),
    sourceFilename: text("source_filename").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    importedAt: integer("imported_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("books_imported_at_idx").on(table.importedAt)],
);

export const bookShelves = sqliteTable(
  "book_shelves",
  {
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    bookshelfId: text("bookshelf_id")
      .notNull()
      .references(() => bookshelves.id, { onDelete: "cascade" }),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bookId, table.bookshelfId] }),
    index("book_shelves_bookshelf_id_added_at_idx").on(table.bookshelfId, table.addedAt),
  ],
);

export const deliveries = sqliteTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id").notNull(),
    bookshelfId: text("bookshelf_id"),
    recipientEmail: text("recipient_email").notNull(),
    status: text("status").$type<"pending" | "sent" | "failed">().notNull(),
    smtpMessageId: text("smtp_message_id"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("deliveries_book_id_created_at_idx").on(table.bookId, table.createdAt)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
