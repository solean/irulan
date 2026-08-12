import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { type Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import Database from "better-sqlite3";
import { openPromise, type ZipFile as ReadZipFile } from "yauzl";
import { ZipFile } from "yazl";
import { z } from "zod";

import { appConfig } from "../config";
import {
  backupDatabase,
  closeDatabase,
  db,
  ensureSchema,
  initializeDatabase,
  setPendingDatabaseRecovery,
  snapshotDatabase,
} from "../db/client";
import { migrateDatabaseSchema } from "../db/migrations";
import { books } from "../db/schema";
import { AppError } from "../errors";
import { bookDirectory } from "../lib/storage";
import { clearPreparedReaderCache } from "./books";
import { withLibraryFileLock } from "./library-lock";

const BACKUP_FORMAT = "irulan-library-backup";
const BACKUP_VERSION = 1;
const MAX_BACKUP_ENTRIES = 100_000;
const MAX_BACKUP_MANIFEST_BYTES = 5 * 1024 * 1024;
const MAX_BACKUP_FILE_BYTES = 8 * 1024 * 1024 * 1024;
export const MAX_LIBRARY_BACKUP_ARCHIVE_BYTES = 25 * 1024 * 1024 * 1024;
const MAX_LIBRARY_BACKUP_EXPANDED_BYTES = 30 * 1024 * 1024 * 1024;

const backupFileSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const backupBookSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  originalPath: z.string().min(1),
  coverPath: z.string().min(1).nullable(),
});
const backupManifestSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    version: z.literal(BACKUP_VERSION),
    createdAt: z.string().datetime(),
    files: z.array(backupFileSchema).max(MAX_BACKUP_ENTRIES),
    books: z.array(backupBookSchema).max(MAX_BACKUP_ENTRIES),
  })
  .strict();

type BackupFile = z.infer<typeof backupFileSchema>;
type BackupBook = z.infer<typeof backupBookSchema>;
type BackupManifest = z.infer<typeof backupManifestSchema>;

type PreparedBackup = {
  cleanup: () => Promise<void>;
  fileName: string;
  filePath: string;
};

type ExtractedFile = BackupFile & { diskPath: string };

let restoreInProgress = false;
export const isLibraryRestoreInProgress = () => restoreInProgress;

const pathExists = async (filePath: string) => {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

const copyAndHash = async (sourcePath: string, targetPath: string): Promise<BackupFile> => {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const hash = createHash("sha256");
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(createReadStream(sourcePath), meter, createWriteStream(targetPath, { flags: "wx" }));
  return { path: "", size, sha256: hash.digest("hex") };
};

const hashFile = async (filePath: string): Promise<Omit<BackupFile, "path">> => {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    hash.update(bytes);
  }
  return { size, sha256: hash.digest("hex") };
};

const writeZip = async (zipPath: string, root: string, manifest: BackupManifest) => {
  const archive = new ZipFile();
  const output = createWriteStream(zipPath, { flags: "wx" });
  const completed = pipeline(archive.outputStream, output);
  archive.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), "manifest.json", {
    mtime: new Date(manifest.createdAt),
  });
  for (const file of manifest.files) {
    archive.addFile(path.join(root, file.path), file.path, { mtime: new Date(manifest.createdAt) });
  }
  archive.end();
  await completed;
};

export const createLibraryBackup = async (): Promise<PreparedBackup> => {
  await mkdir(appConfig.dataDir, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(appConfig.dataDir, "library-backup-"));
  const payloadRoot = path.join(temporaryRoot, "payload");
  const createdAt = new Date();

  try {
    const manifest = await withLibraryFileLock(async (): Promise<BackupManifest> => {
      await mkdir(payloadRoot, { recursive: true });
      const databaseArchivePath = "library.sqlite";
      const stagedDatabasePath = path.join(payloadRoot, databaseArchivePath);
      await snapshotDatabase(stagedDatabasePath);
      const databaseFile = {
        path: databaseArchivePath,
        ...(await hashFile(stagedDatabasePath)),
      };

      const files: BackupFile[] = [databaseFile];
      const manifestBooks: BackupBook[] = [];
      const bookRows = db.select().from(books).all();

      for (const book of bookRows) {
        const expectedDirectory = path.resolve(bookDirectory(book.id));
        const originalSource = path.resolve(book.filePath);
        if (
          originalSource !== path.join(expectedDirectory, "original.epub") ||
          !(await pathExists(originalSource))
        ) {
          throw new AppError(500, `The original EPUB for “${book.title}” is missing.`);
        }

        const originalPath = path.posix.join("books", book.id, "original.epub");
        const originalFile = await copyAndHash(originalSource, path.join(payloadRoot, originalPath));
        originalFile.path = originalPath;
        if (
          originalFile.sha256 !== book.fileHash ||
          originalFile.size !== book.fileSizeBytes
        ) {
          throw new AppError(500, `The original EPUB for “${book.title}” is damaged.`);
        }
        files.push(originalFile);

        let coverPath: string | null = null;
        if (book.coverPath) {
          const coverSource = path.resolve(book.coverPath);
          if (
            path.dirname(coverSource) !== expectedDirectory ||
            !(await pathExists(coverSource))
          ) {
            throw new AppError(500, `The cover for “${book.title}” is missing.`);
          }
          coverPath = path.posix.join("books", book.id, path.basename(coverSource));
          const coverFile = await copyAndHash(coverSource, path.join(payloadRoot, coverPath));
          coverFile.path = coverPath;
          files.push(coverFile);
        }

        manifestBooks.push({ id: book.id, originalPath, coverPath });
      }

      files.sort((left, right) => left.path.localeCompare(right.path));
      manifestBooks.sort((left, right) => left.id.localeCompare(right.id));
      return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        createdAt: createdAt.toISOString(),
        files,
        books: manifestBooks,
      };
    });

    const fileName = `irulan-library-${createdAt.toISOString().slice(0, 10)}.zip`;
    const zipPath = path.join(temporaryRoot, fileName);
    await writeZip(zipPath, payloadRoot, manifest);
    return {
      fileName,
      filePath: zipPath,
      cleanup: () => rm(temporaryRoot, { force: true, recursive: true }),
    };
  } catch (error) {
    await rm(temporaryRoot, { force: true, recursive: true });
    throw error;
  }
};

const safeArchivePath = (entryName: string) => {
  if (
    !entryName ||
    entryName.includes("\\") ||
    entryName.includes("\0") ||
    path.posix.isAbsolute(entryName)
  ) {
    throw new AppError(400, "The backup contains an unsafe file path.");
  }
  const normalized = path.posix.normalize(entryName);
  if (normalized !== entryName || normalized === ".." || normalized.startsWith("../")) {
    throw new AppError(400, "The backup contains an unsafe file path.");
  }
  return normalized;
};

const extractBackup = async (archivePath: string, targetRoot: string) => {
  let archive: ReadZipFile;
  try {
    archive = await openPromise(archivePath, {
      autoClose: false,
      lazyEntries: true,
      validateEntrySizes: true,
    });
  } catch {
    throw new AppError(400, "This file is not a valid Irulan library backup.");
  }

  const files = new Map<string, ExtractedFile>();
  let entryCount = 0;
  let expandedBytes = 0;
  try {
    for await (const entry of archive.eachEntry()) {
      entryCount += 1;
      if (entryCount > MAX_BACKUP_ENTRIES) {
        throw new AppError(400, "The backup contains too many files.");
      }
      if (entry.fileName.endsWith("/")) continue;
      const archiveFilePath = safeArchivePath(entry.fileName);
      if (files.has(archiveFilePath)) {
        throw new AppError(400, "The backup contains duplicate file paths.");
      }
      const maximumFileBytes =
        archiveFilePath === "manifest.json" ? MAX_BACKUP_MANIFEST_BYTES : MAX_BACKUP_FILE_BYTES;
      if (entry.uncompressedSize > maximumFileBytes) {
        throw new AppError(400, `The backup file “${archiveFilePath}” is too large.`);
      }
      expandedBytes += entry.uncompressedSize;
      if (expandedBytes > MAX_LIBRARY_BACKUP_EXPANDED_BYTES) {
        throw new AppError(400, "The expanded backup is too large.");
      }

      const diskPath = path.join(targetRoot, ...archiveFilePath.split("/"));
      await mkdir(path.dirname(diskPath), { recursive: true });
      const hash = createHash("sha256");
      let size = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length;
          if (size > maximumFileBytes) {
            callback(new AppError(400, `The backup file “${archiveFilePath}” is too large.`));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      const source = await archive.openReadStreamPromise(entry);
      await pipeline(source, meter, createWriteStream(diskPath, { flags: "wx" }));
      files.set(archiveFilePath, {
        path: archiveFilePath,
        diskPath,
        size,
        sha256: hash.digest("hex"),
      });
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "This file is not a valid Irulan library backup.");
  } finally {
    archive.close();
  }
  return files;
};

const validateManifest = async (files: Map<string, ExtractedFile>) => {
  const manifestFile = files.get("manifest.json");
  if (!manifestFile) throw new AppError(400, "The backup manifest is missing.");

  let manifest: BackupManifest;
  try {
    manifest = backupManifestSchema.parse(JSON.parse(await readFile(manifestFile.diskPath, "utf8")));
  } catch {
    throw new AppError(400, "The backup manifest is invalid.");
  }

  const expectedPaths = new Set(["manifest.json"]);
  for (const expected of manifest.files) {
    if (expectedPaths.has(expected.path)) {
      throw new AppError(400, "The backup manifest contains duplicate file paths.");
    }
    safeArchivePath(expected.path);
    expectedPaths.add(expected.path);
    const actual = files.get(expected.path);
    if (!actual || actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw new AppError(400, `The backup file “${expected.path}” is missing or damaged.`);
    }
  }
  if (expectedPaths.size !== files.size || Array.from(files.keys()).some((entry) => !expectedPaths.has(entry))) {
    throw new AppError(400, "The backup contains files not declared by its manifest.");
  }

  const bookIds = new Set<string>();
  for (const book of manifest.books) {
    if (bookIds.has(book.id)) throw new AppError(400, "The backup manifest contains duplicate books.");
    bookIds.add(book.id);
    if (!expectedPaths.has(book.originalPath) || (book.coverPath && !expectedPaths.has(book.coverPath))) {
      throw new AppError(400, "The backup manifest references a missing book file.");
    }
  }
  return manifest;
};

const validateAndRebaseDatabase = (
  databasePath: string,
  manifest: BackupManifest,
  extractedFiles: Map<string, ExtractedFile>,
) => {
  const database = new Database(databasePath, { fileMustExist: true });
  try {
    database.pragma("foreign_keys = ON");
    migrateDatabaseSchema(database, path.join(appConfig.rootDir, "drizzle"));
    const quickCheck = database.pragma("quick_check") as { quick_check: string }[];
    if (quickCheck[0]?.quick_check !== "ok") throw new Error("SQLite quick check failed.");
    const foreignKeyErrors = database.pragma("foreign_key_check") as unknown[];
    if (foreignKeyErrors.length > 0) throw new Error("SQLite foreign key check failed.");

    const requiredTables = ["books", "bookshelves", "settings", "reader_bookmarks", "reader_annotations"];
    const tableExists = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .pluck();
    if (requiredTables.some((table) => !tableExists.get(table))) {
      throw new Error("Required library tables are missing.");
    }

    const rows = database
      .prepare(
        "SELECT id, file_hash AS fileHash, file_size_bytes AS fileSizeBytes FROM books ORDER BY id",
      )
      .all() as { id: string; fileHash: string; fileSizeBytes: number }[];
    const manifestById = new Map(manifest.books.map((book) => [book.id, book]));
    if (rows.length !== manifest.books.length) throw new Error("The book manifest does not match the database.");

    const updatePaths = database.prepare("UPDATE books SET file_path = ?, cover_path = ? WHERE id = ?");
    const rebase = database.transaction(() => {
      for (const row of rows) {
        const book = manifestById.get(row.id);
        if (!book) throw new Error("The book manifest does not match the database.");
        const original = extractedFiles.get(book.originalPath);
        if (
          !original ||
          original.sha256 !== row.fileHash ||
          original.size !== row.fileSizeBytes
        ) {
          throw new Error("An original EPUB does not match its database record.");
        }
        updatePaths.run(
          path.join(bookDirectory(row.id), "original.epub"),
          book.coverPath
            ? path.join(bookDirectory(row.id), path.posix.basename(book.coverPath))
            : null,
          row.id,
        );
      }
    });
    rebase();
  } catch (error) {
    throw new AppError(400, error instanceof Error ? `The backup database is invalid: ${error.message}` : "The backup database is invalid.");
  } finally {
    database.close();
  }
};

const applyRestore = async (stagedRoot: string, stagedDatabasePath: string) => {
  const restoreId = randomUUID();
  const booksPath = path.join(appConfig.storageDir, "books");
  const stagedBooksPath = path.join(stagedRoot, "books");
  const oldBooksPath = path.join(appConfig.storageDir, `.restore-old-books-${restoreId}`);
  const newDatabasePath = `${appConfig.dbPath}.restore-new-${restoreId}`;
  const oldDatabasePath = `${appConfig.dbPath}.restore-old-${restoreId}`;
  const backupPath = `${appConfig.dbPath}.bak`;
  const oldBackupPath = `${backupPath}.restore-old-${restoreId}`;
  await mkdir(stagedBooksPath, { recursive: true });
  await copyFile(stagedDatabasePath, newDatabasePath);

  await withLibraryFileLock(async () => {
    restoreInProgress = true;
    let movedBooks = false;
    let movedDatabase = false;
    let movedBackup = false;
    let installedBooks = false;
    let installedDatabase = false;
    try {
      closeDatabase();
      if (await pathExists(booksPath)) {
        await rename(booksPath, oldBooksPath);
        movedBooks = true;
      }
      if (await pathExists(appConfig.dbPath)) {
        await rename(appConfig.dbPath, oldDatabasePath);
        movedDatabase = true;
      }
      if (await pathExists(backupPath)) {
        await rename(backupPath, oldBackupPath);
        movedBackup = true;
      }
      await rm(`${appConfig.dbPath}-wal`, { force: true });
      await rm(`${appConfig.dbPath}-shm`, { force: true });
      await rename(stagedBooksPath, booksPath);
      installedBooks = true;
      await rename(newDatabasePath, appConfig.dbPath);
      installedDatabase = true;

      await initializeDatabase();
      ensureSchema();
      setPendingDatabaseRecovery(null);
      clearPreparedReaderCache();
      await backupDatabase();

      await rm(oldBooksPath, { force: true, recursive: true }).catch((cleanupError) => {
        console.warn("Could not remove the previous restored book directory.", cleanupError);
      });
      await rm(oldDatabasePath, { force: true }).catch((cleanupError) => {
        console.warn("Could not remove the previous restored database.", cleanupError);
      });
      await rm(oldBackupPath, { force: true }).catch((cleanupError) => {
        console.warn("Could not remove the previous database backup.", cleanupError);
      });
    } catch (error) {
      closeDatabase();
      if (installedBooks) await rm(booksPath, { force: true, recursive: true });
      if (installedDatabase) {
        await rm(appConfig.dbPath, { force: true });
        await rm(`${appConfig.dbPath}-wal`, { force: true });
        await rm(`${appConfig.dbPath}-shm`, { force: true });
      }
      if (movedBooks) await rename(oldBooksPath, booksPath);
      if (movedDatabase) await rename(oldDatabasePath, appConfig.dbPath);
      if (movedBackup) await rename(oldBackupPath, backupPath);
      await rm(newDatabasePath, { force: true });
      try {
        await initializeDatabase();
        ensureSchema();
        clearPreparedReaderCache();
      } catch (rollbackError) {
        console.error("Library restore rollback could not reopen the previous database.", rollbackError);
      }
      console.error("Library restore failed after validation.", error);
      throw new AppError(500, "The library could not be restored; the previous library was kept.");
    } finally {
      restoreInProgress = false;
    }
  });
};

export const restoreLibraryBackup = async (archivePath: string) => {
  await mkdir(appConfig.storageDir, { recursive: true });
  const stagedRoot = await mkdtemp(path.join(appConfig.storageDir, ".restore-stage-"));
  try {
    const extractedFiles = await extractBackup(archivePath, stagedRoot);
    const manifest = await validateManifest(extractedFiles);
    const stagedDatabase = extractedFiles.get("library.sqlite");
    if (!stagedDatabase) throw new AppError(400, "The backup database is missing.");
    validateAndRebaseDatabase(stagedDatabase.diskPath, manifest, extractedFiles);
    await applyRestore(stagedRoot, stagedDatabase.diskPath);
    return { restoredAt: new Date().toISOString(), bookCount: manifest.books.length };
  } finally {
    await rm(stagedRoot, { force: true, recursive: true });
  }
};

export const storeLibraryBackupUpload = async (source: Readable) => {
  await mkdir(appConfig.dataDir, { recursive: true });
  const uploadPath = path.join(appConfig.dataDir, `.library-restore-${randomUUID()}.zip`);
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > MAX_LIBRARY_BACKUP_ARCHIVE_BYTES) {
        callback(new AppError(413, "The library backup file is too large."));
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(source, meter, createWriteStream(uploadPath, { flags: "wx" }));
    if (size === 0) throw new AppError(400, "Choose a library backup file to restore.");
    return uploadPath;
  } catch (error) {
    await rm(uploadPath, { force: true });
    throw error;
  }
};
