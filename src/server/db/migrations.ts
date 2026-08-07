import { drizzle } from "drizzle-orm/sql-js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import type { Database } from "sql.js";

const tableExists = (database: Database, table: string) => {
  const result = database.exec(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $table LIMIT 1;",
    { $table: table },
  );
  return Boolean(result[0]?.values.length);
};

const columnExists = (database: Database, table: string, column: string) => {
  const [result] = database.exec(`PRAGMA table_info(${table});`);
  return result?.values.some((row) => row[1] === column) ?? false;
};

/**
 * Databases created before migrations were introduced have no journal, and a few
 * historical columns were added conditionally at startup. Bring only those known
 * legacy shapes up to the baseline; committed migrations own every later change.
 */
const upgradePreMigrationDatabase = (database: Database) => {
  if (tableExists(database, "__drizzle_migrations")) {
    return;
  }

  if (tableExists(database, "deliveries") && !columnExists(database, "deliveries", "bookshelf_id")) {
    database.run("ALTER TABLE deliveries ADD COLUMN bookshelf_id TEXT;");
  }

  if (tableExists(database, "books") && !columnExists(database, "books", "reading_status")) {
    database.run("ALTER TABLE books ADD COLUMN reading_status TEXT NOT NULL DEFAULT 'unread';");
  }

  if (tableExists(database, "books") && !columnExists(database, "books", "rating")) {
    database.run("ALTER TABLE books ADD COLUMN rating REAL;");
  }
};

export const migrateDatabaseSchema = (database: Database, migrationsFolder: string) => {
  upgradePreMigrationDatabase(database);
  migrate(drizzle(database), { migrationsFolder });
};
