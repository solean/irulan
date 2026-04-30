import { mkdirSync } from "node:fs";
import path from "node:path";

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import { appConfig } from "../config";
import * as schema from "./schema";

mkdirSync(path.dirname(appConfig.dbPath), { recursive: true });

const sqlite = new Database(appConfig.dbPath, { create: true });

sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });

export const ensureSchema = () => {
  sqlite.exec(`
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
};
