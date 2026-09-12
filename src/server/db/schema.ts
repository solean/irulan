import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { ReadStatus, ReaderAnnotationColor } from "../../shared/types";

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
    readStatus: text("reading_status").$type<ReadStatus>().notNull().default("unread"),
    rating: real("rating"),
  },
  (table) => [index("books_imported_at_idx").on(table.importedAt)],
);

export const readerSectionText = sqliteTable(
  "reader_section_text",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    href: text("href").notNull(),
    label: text("label").notNull(),
    spineIndex: integer("spine_index").notNull(),
    textVersion: integer("text_version").notNull(),
    text: text("text").notNull(),
    indexedAt: integer("indexed_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("reader_section_text_book_id_href_idx").on(table.bookId, table.href),
    index("reader_section_text_book_id_spine_index_idx").on(table.bookId, table.spineIndex),
  ],
);

export const readerBookmarks = sqliteTable(
  "reader_bookmarks",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    label: text("label"),
    sectionHref: text("section_href").notNull(),
    textVersion: integer("text_version").notNull(),
    offset: integer("offset").notNull(),
    prefix: text("prefix").notNull(),
    suffix: text("suffix").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("reader_bookmarks_book_id_created_at_idx").on(table.bookId, table.createdAt),
  ],
);

export const readerAnnotations = sqliteTable(
  "reader_annotations",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    sectionHref: text("section_href").notNull(),
    textVersion: integer("text_version").notNull(),
    offset: integer("offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    exact: text("exact").notNull(),
    prefix: text("prefix").notNull(),
    suffix: text("suffix").notNull(),
    color: text("color").$type<ReaderAnnotationColor>().notNull(),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    // One highlight per anchored range: re-highlighting a passage recolours the
    // saved annotation instead of stacking a second one over the same text.
    uniqueIndex("reader_annotations_book_id_range_idx").on(
      table.bookId,
      table.sectionHref,
      table.textVersion,
      table.offset,
      table.endOffset,
    ),
    index("reader_annotations_book_id_created_at_idx").on(table.bookId, table.createdAt),
  ],
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
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    bookshelfId: text("bookshelf_id").references(() => bookshelves.id, {
      onDelete: "set null",
    }),
    recipientEmail: text("recipient_email").notNull(),
    status: text("status").$type<"pending" | "sent" | "failed">().notNull(),
    smtpMessageId: text("smtp_message_id"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("deliveries_book_id_created_at_idx").on(table.bookId, table.createdAt),
    index("deliveries_bookshelf_id_created_at_idx").on(table.bookshelfId, table.createdAt),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
