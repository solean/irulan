import path from "node:path";

import { drizzle, type SQLJsDatabase } from "drizzle-orm/sql-js";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

import type { DatabaseRecovery } from "../../shared/types";
import { appConfig } from "../config";
import { openDatabaseWithRecovery, persistDatabaseAtomically } from "./persistence";
import * as schema from "./schema";

let sqlite: Database | null = null;
let sqlModule: SqlJsStatic | null = null;

export let db: SQLJsDatabase<typeof schema>;

/**
 * Recovery happens before `ensureSchema` has run, so the `settings` table that
 * holds the notice may not exist yet — and on the `persistDatabase` rollback
 * path the disk is failing, so nothing can be written at all. Park the record
 * here; `services/settings` moves it to storage when it can and reads through
 * to it when it cannot.
 */
let pendingRecovery: DatabaseRecovery | null = null;

export const getPendingDatabaseRecovery = () => pendingRecovery;

export const setPendingDatabaseRecovery = (recovery: DatabaseRecovery | null) => {
  pendingRecovery = recovery;
};

const noteRecovery = (recovery: DatabaseRecovery | null) => {
  if (!recovery) {
    return;
  }

  setPendingDatabaseRecovery(recovery);
  console.warn(
    `Recovered Irulan database from ${appConfig.dbPath}.bak (${recovery.reason}), ` +
      `current as of ${recovery.backupModifiedAt ?? "an unknown time"}.`,
  );
};

const requireSqlite = () => {
  if (!sqlite) {
    throw new Error("Database has not been initialized.");
  }

  return sqlite;
};

const requireSqlModule = () => {
  if (!sqlModule) {
    throw new Error("Database has not been initialized.");
  }

  return sqlModule;
};

/**
 * Point the in-memory database at what is currently stored.
 *
 * `db` is a live export binding, so every service that imported it picks up the
 * replacement on its next query rather than holding the old handle.
 */
const reloadFromDisk = () => {
  const previous = sqlite;
  const opened = openDatabaseWithRecovery(requireSqlModule(), appConfig.dbPath);

  // Only give up the working handle once the replacement is open.
  sqlite = opened.database;
  sqlite.run("PRAGMA foreign_keys = ON;");
  db = drizzle(sqlite, { schema });
  previous?.close();

  noteRecovery(opened.recovery);

  return opened.recovery;
};

export const persistDatabase = () => {
  try {
    persistDatabaseAtomically(requireSqlModule(), requireSqlite(), appConfig.dbPath);
  } catch (error) {
    // The caller already applied its change in memory, but it never reached
    // disk. Left alone, the API would report that change as saved and it would
    // disappear on the next restart, so roll memory back to what is stored and
    // let the failure surface.
    try {
      reloadFromDisk();
    } catch (reloadError) {
      console.error(
        "The database could not be saved, and the in-memory copy could not be rolled " +
          "back to match what is stored. It now holds changes that are not on disk.",
        reloadError,
      );
    }

    throw error;
  }
};

export const initializeDatabase = async () => {
  if (sqlite) {
    return;
  }

  const SQL = await initSqlJs({
    locateFile: (file) => path.join(appConfig.rootDir, "node_modules/sql.js/dist", file),
  });

  const opened = openDatabaseWithRecovery(SQL, appConfig.dbPath);
  sqlModule = SQL;
  sqlite = opened.database;
  noteRecovery(opened.recovery);
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
      imported_at INTEGER NOT NULL,
      reading_status TEXT NOT NULL DEFAULT 'unread',
      rating REAL
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

  if (!hasColumn("books", "reading_status")) {
    client.run("ALTER TABLE books ADD COLUMN reading_status TEXT NOT NULL DEFAULT 'unread';");
  }

  if (!hasColumn("books", "rating")) {
    client.run("ALTER TABLE books ADD COLUMN rating REAL;");
  }

  client.run(`
    UPDATE books
    SET reading_status = 'unread'
    WHERE reading_status IS NULL
      OR reading_status NOT IN ('unread', 'reading', 'finished');

    UPDATE books
    SET rating = NULL
    WHERE rating IS NOT NULL
      AND (
        rating < 0.5
        OR rating > 5
        OR rating * 2 != CAST(rating * 2 AS INTEGER)
      );

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
