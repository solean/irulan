import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tableExists = (database: Database.Database, table: string) =>
  Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1;")
      .pluck()
      .get(table),
  );

const columnExists = (database: Database.Database, table: string, column: string) =>
  (database.pragma(`table_info(${table})`) as { name: string }[]).some(
    (row) => row.name === column,
  );

/**
 * Databases created before migrations were introduced have no journal, and a few
 * historical columns were added conditionally at startup. Bring only those known
 * legacy shapes up to the baseline; committed migrations own every later change.
 */
const upgradePreMigrationDatabase = (database: Database.Database) => {
  if (tableExists(database, "__drizzle_migrations")) {
    return;
  }

  if (tableExists(database, "deliveries") && !columnExists(database, "deliveries", "bookshelf_id")) {
    database.exec("ALTER TABLE deliveries ADD COLUMN bookshelf_id TEXT;");
  }

  if (tableExists(database, "books") && !columnExists(database, "books", "reading_status")) {
    database.exec("ALTER TABLE books ADD COLUMN reading_status TEXT NOT NULL DEFAULT 'unread';");
  }

  if (tableExists(database, "books") && !columnExists(database, "books", "rating")) {
    database.exec("ALTER TABLE books ADD COLUMN rating REAL;");
  }
};

export const migrateDatabaseSchema = (database: Database.Database, migrationsFolder: string) => {
  upgradePreMigrationDatabase(database);
  migrate(drizzle(database), { migrationsFolder });
};
