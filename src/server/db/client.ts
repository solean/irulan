import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { drizzle, type SQLJsDatabase } from "drizzle-orm/sql-js";
import initSqlJs, { type Database } from "sql.js";

import { appConfig } from "../config";
import * as schema from "./schema";

mkdirSync(path.dirname(appConfig.dbPath), { recursive: true });

let sqlite: Database | null = null;

export let db: SQLJsDatabase<typeof schema>;

const requireSqlite = () => {
  if (!sqlite) {
    throw new Error("Database has not been initialized.");
  }

  return sqlite;
};

export const persistDatabase = () => {
  const client = requireSqlite();
  writeFileSync(appConfig.dbPath, Buffer.from(client.export()));
};

export const initializeDatabase = async () => {
  if (sqlite) {
    return;
  }

  const SQL = await initSqlJs({
    locateFile: (file) => path.join(appConfig.rootDir, "node_modules/sql.js/dist", file),
  });

  const dbBytes = existsSync(appConfig.dbPath) ? readFileSync(appConfig.dbPath) : null;
  sqlite = new SQL.Database(dbBytes);
  sqlite.run("PRAGMA foreign_keys = ON;");
  db = drizzle(sqlite, { schema });
};

export const ensureSchema = () => {
  const client = requireSqlite();
  const hasColumn = (table: string, column: string) => {
    const [result] = client.exec(`PRAGMA table_info(${table})`);
    return result?.values.some((row) => row[1] === column) ?? false;
  };

  client.run(`
    CREATE TABLE IF NOT EXISTS bookshelves (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      kindle_email TEXT,
      sort_order INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS books (
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

    CREATE TABLE IF NOT EXISTS book_shelves (
      book_id TEXT NOT NULL,
      bookshelf_id TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY(book_id, bookshelf_id),
      FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY(bookshelf_id) REFERENCES bookshelves(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      bookshelf_id TEXT,
      recipient_email TEXT NOT NULL,
      status TEXT NOT NULL,
      smtp_message_id TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      sent_at INTEGER,
      FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY(bookshelf_id) REFERENCES bookshelves(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS bookshelves_sort_order_idx
      ON bookshelves(sort_order);

    CREATE INDEX IF NOT EXISTS books_imported_at_idx
      ON books(imported_at);

    CREATE INDEX IF NOT EXISTS book_shelves_bookshelf_id_added_at_idx
      ON book_shelves(bookshelf_id, added_at);

    CREATE INDEX IF NOT EXISTS deliveries_book_id_created_at_idx
      ON deliveries(book_id, created_at);
  `);

  if (!hasColumn("deliveries", "bookshelf_id")) {
    client.run("ALTER TABLE deliveries ADD COLUMN bookshelf_id TEXT;");
  }

  client.run(`
    CREATE INDEX IF NOT EXISTS deliveries_bookshelf_id_created_at_idx
      ON deliveries(bookshelf_id, created_at);

    INSERT INTO bookshelves (id, name, kindle_email, sort_order, created_at)
    SELECT
      'default',
      'My bookshelf',
      (SELECT NULLIF(TRIM(value), '') FROM settings WHERE key = 'default_kindle_email'),
      0,
      CAST(strftime('%s', 'now') AS INTEGER) * 1000
    WHERE NOT EXISTS (SELECT 1 FROM bookshelves);

    INSERT OR IGNORE INTO book_shelves (book_id, bookshelf_id, added_at)
    SELECT books.id, 'default', books.imported_at
    FROM books
    WHERE EXISTS (SELECT 1 FROM bookshelves WHERE id = 'default')
      AND NOT EXISTS (
        SELECT 1
        FROM book_shelves
        WHERE book_shelves.book_id = books.id
      );
  `);

  persistDatabase();
};
