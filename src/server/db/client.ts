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

  client.run(`
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

    CREATE TABLE IF NOT EXISTS deliveries (
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS books_imported_at_idx
      ON books(imported_at);

    CREATE INDEX IF NOT EXISTS deliveries_book_id_created_at_idx
      ON deliveries(book_id, created_at);
  `);

  persistDatabase();
};
