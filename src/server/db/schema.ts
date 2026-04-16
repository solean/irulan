import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  filePath: text("file_path").notNull(),
  coverPath: text("cover_path"),
  fileHash: text("file_hash").notNull().unique(),
  sourceFilename: text("source_filename").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  importedAt: integer("imported_at", { mode: "timestamp_ms" }).notNull(),
});

export const deliveries = sqliteTable("deliveries", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  status: text("status").$type<"pending" | "sent" | "failed">().notNull(),
  smtpMessageId: text("smtp_message_id"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
