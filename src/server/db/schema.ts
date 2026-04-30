import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const deliveries = sqliteTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id").notNull(),
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
