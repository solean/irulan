import path from "node:path";

import { beforeAll, describe, expect, test } from "bun:test";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

import { migrateDatabaseSchema } from "./migrations";

let SQL: SqlJsStatic;
const migrationsFolder = path.join(process.cwd(), "drizzle");

const rows = (database: Database, query: string) => database.exec(query)[0]?.values ?? [];

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => path.join(process.cwd(), "node_modules/sql.js/dist", file),
  });
});

describe("database migrations", () => {
  test("creates the current schema and records the baseline once", () => {
    const database = new SQL.Database();
    database.run("PRAGMA foreign_keys = ON;");

    try {
      migrateDatabaseSchema(database, migrationsFolder);
      migrateDatabaseSchema(database, migrationsFolder);

      expect(rows(database, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;")).toEqual([
        ["__drizzle_migrations"],
        ["book_shelves"],
        ["books"],
        ["bookshelves"],
        ["deliveries"],
        ["settings"],
      ]);
      expect(rows(database, "SELECT COUNT(*) FROM __drizzle_migrations;")).toEqual([[1]]);
      expect(rows(database, "SELECT id, name FROM bookshelves;")).toEqual([
        ["default", "My bookshelf"],
      ]);
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
    const database = new SQL.Database();
    database.run("PRAGMA foreign_keys = ON;");
    database.run(`
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
      expect(
        rows(database, "SELECT id, book_id, bookshelf_id, status FROM deliveries;")
      ).toEqual([["delivery-1", "book-1", null, "sent"]]);
      expect(rows(database, "SELECT book_id, bookshelf_id FROM book_shelves;")).toEqual([
        ["book-1", "default"],
      ]);
      expect(rows(database, "SELECT COUNT(*) FROM __drizzle_migrations;")).toEqual([[1]]);
    } finally {
      database.close();
    }
  });
});
