import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";

import { migrateDatabaseSchema } from "./migrations";

const migrationsFolder = path.join(process.cwd(), "drizzle");

/**
 * Migrations are asserted against column values rather than object keys, so the
 * queries name their columns and the rows come back as tuples.
 */
const rows = (database: Database.Database, query: string) =>
  database
    .prepare(query)
    .raw()
    .all() as unknown[][];

const freshDatabase = () => {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  return database;
};

describe("database migrations", () => {
  test("creates the current schema and records the baseline once", () => {
    const database = freshDatabase();

    try {
      migrateDatabaseSchema(database, migrationsFolder);
      migrateDatabaseSchema(database, migrationsFolder);

      expect(
        rows(
          database,
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'reader_section_fts_%' ORDER BY name;",
        ),
      ).toEqual([
        ["__drizzle_migrations"],
        ["book_shelves"],
        ["books"],
        ["bookshelves"],
        ["deliveries"],
        ["reader_annotations"],
        ["reader_bookmarks"],
        ["reader_section_fts"],
        ["reader_section_text"],
        ["settings"],
        ["sqlite_sequence"],
      ]);
      expect(rows(database, "SELECT COUNT(*) FROM __drizzle_migrations;")).toEqual([[4]]);
      expect(rows(database, "SELECT id, name FROM bookshelves;")).toEqual([
        ["default", "My bookshelf"],
      ]);
      database.exec(`
        INSERT INTO books (
          id, title, author, file_path, file_hash, source_filename, file_size_bytes, imported_at
        ) VALUES ('search-book', 'Search', 'Author', '/book.epub', 'hash', 'book.epub', 1, 1);
        INSERT INTO reader_section_text (
          book_id, href, label, spine_index, text_version, text, indexed_at
        ) VALUES ('search-book', 'chapter.xhtml', 'Chapter', 0, 1, 'searchable passage', 1);
      `);
      expect(
        rows(
          database,
          "SELECT text FROM reader_section_fts WHERE reader_section_fts MATCH 'searchable';",
        ),
      ).toEqual([["searchable passage"]]);
      database.exec("DELETE FROM books WHERE id = 'search-book';");
      expect(rows(database, "SELECT COUNT(*) FROM reader_section_fts;")).toEqual([[0]]);
      expect(
        rows(
          database,
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'deliveries' ORDER BY name;",
        ),
      ).toEqual([
        ["deliveries_book_id_created_at_idx"],
        ["deliveries_bookshelf_id_created_at_idx"],
        ["sqlite_autoindex_deliveries_1"],
      ]);
      expect(
        rows(database, "PRAGMA foreign_key_list(deliveries);").map((row) => [
          row[2],
          row[3],
          row[4],
          row[6],
        ]),
      ).toEqual([
        ["bookshelves", "bookshelf_id", "id", "SET NULL"],
        ["books", "book_id", "id", "CASCADE"],
      ]);
    } finally {
      database.close();
    }
  });

  test("upgrades a pre-migration database without losing existing records", () => {
    const database = freshDatabase();
    database.exec(`
      CREATE TABLE bookshelves (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        kindle_email TEXT,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE books (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        file_path TEXT NOT NULL,
        cover_path TEXT,
        file_hash TEXT NOT NULL UNIQUE,
        source_filename TEXT NOT NULL,
        file_size_bytes INTEGER NOT NULL,
        imported_at INTEGER NOT NULL
      );
      CREATE TABLE deliveries (
        id TEXT PRIMARY KEY NOT NULL,
        book_id TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        status TEXT NOT NULL,
        smtp_message_id TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        sent_at INTEGER,
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
      INSERT INTO bookshelves (id, name, sort_order, created_at)
      VALUES ('default', 'Existing shelf', 0, 1);
      INSERT INTO books (
        id, title, author, file_path, file_hash, source_filename, file_size_bytes, imported_at
      ) VALUES ('book-1', 'Existing book', 'Author', '/book.epub', 'hash', 'book.epub', 10, 2);
      INSERT INTO deliveries (id, book_id, recipient_email, status, created_at)
      VALUES ('delivery-1', 'book-1', 'reader@example.com', 'sent', 3);
    `);

    try {
      migrateDatabaseSchema(database, migrationsFolder);

      expect(rows(database, "SELECT reading_status, rating FROM books WHERE id = 'book-1';")).toEqual([
        ["unread", null],
      ]);
      expect(rows(database, "SELECT id, book_id, bookshelf_id, status FROM deliveries;")).toEqual([
        ["delivery-1", "book-1", null, "sent"],
      ]);
      expect(rows(database, "SELECT book_id, bookshelf_id FROM book_shelves;")).toEqual([
        ["book-1", "default"],
      ]);
      expect(rows(database, "SELECT COUNT(*) FROM __drizzle_migrations;")).toEqual([[4]]);
    } finally {
      database.close();
    }
  });

  test("collapses annotations that duplicate an anchored range", () => {
    const legacyFolder = path.join(
      mkdtempSync(path.join(tmpdir(), "irulan-migrations-")),
      "drizzle",
    );
    cpSync(migrationsFolder, legacyFolder, { recursive: true });
    const journalPath = path.join(legacyFolder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: { tag: string }[];
    };
    journal.entries = journal.entries.filter((entry) => entry.tag !== "0003_bizarre_ultragirl");
    writeFileSync(journalPath, JSON.stringify(journal));

    const database = freshDatabase();
    try {
      migrateDatabaseSchema(database, legacyFolder);
      database.exec(`
        INSERT INTO books (
          id, title, author, file_path, file_hash, source_filename, file_size_bytes,
          imported_at, reading_status
        ) VALUES ('book-1', 'Book', 'Author', '/book.epub', 'hash', 'book.epub', 10, 1, 'unread');
        INSERT INTO reader_annotations (
          id, book_id, section_href, text_version, offset, end_offset, exact, prefix, suffix,
          color, note, created_at, updated_at
        ) VALUES
          ('older', 'book-1', 'c1.xhtml', 1, 10, 17, 'horizon', 'a', 'b', 'green', 'Kept note', 100, 100),
          ('newer', 'book-1', 'c1.xhtml', 1, 10, 17, 'horizon', 'a', 'b', 'blue', NULL, 200, 200),
          ('other', 'book-1', 'c1.xhtml', 1, 20, 29, 'Lightning', 'a', 'b', 'pink', NULL, 300, 300);
      `);

      migrateDatabaseSchema(database, migrationsFolder);

      expect(
        rows(database, "SELECT id, color, note FROM reader_annotations ORDER BY offset;"),
      ).toEqual([
        ["newer", "blue", "Kept note"],
        ["other", "pink", null],
      ]);
      expect(() =>
        database.exec(`
          INSERT INTO reader_annotations (
            id, book_id, section_href, text_version, offset, end_offset, exact, prefix, suffix,
            color, note, created_at, updated_at
          ) VALUES
            ('duplicate', 'book-1', 'c1.xhtml', 1, 10, 17, 'horizon', 'a', 'b', 'yellow', NULL, 400, 400);
        `),
      ).toThrow(/UNIQUE/);
    } finally {
      database.close();
      rmSync(legacyFolder, { force: true, recursive: true });
    }
  });
});
