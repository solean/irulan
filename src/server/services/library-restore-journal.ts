import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { appConfig } from "../config";

const journalSchema = z.object({
  id: z.string().uuid(),
  phase: z.enum(["prepared", "committed"]),
  hadBooks: z.boolean(),
  hadDatabase: z.boolean(),
  hadBackup: z.boolean(),
}).strict();
type RestoreJournal = z.infer<typeof journalSchema>;

const journalPath = () => path.join(appConfig.dataDir, ".library-restore.json");
export const restorePaths = (id: string) => ({
  books: path.join(appConfig.storageDir, "books"),
  oldBooks: path.join(appConfig.storageDir, `.restore-old-books-${id}`),
  database: appConfig.dbPath,
  oldDatabase: `${appConfig.dbPath}.restore-old-${id}`,
  newDatabase: `${appConfig.dbPath}.restore-new-${id}`,
  backup: `${appConfig.dbPath}.bak`,
  oldBackup: `${appConfig.dbPath}.bak.restore-old-${id}`,
});

const exists = async (filePath: string) => {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

/** Flush payload bytes and nested directory entries before committing a restore.
 * Syncing only the books root would not make its EPUBs and covers durable.
 */
export const syncRestoreTree = async (directory: string): Promise<void> => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await syncRestoreTree(filePath);
    } else if (entry.isFile()) {
      const handle = await open(filePath, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } else {
      throw new Error("The restored library contains an unsupported file type.");
    }
  }
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

// Persist directory entries as well as journal bytes. Recovery decisions must
// not reach disk ahead of the renames they describe.
export const syncRestoreDirectories = async () => {
  for (const directory of new Set([appConfig.dataDir, appConfig.storageDir])) {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
};

const writeJournal = async (journal: RestoreJournal) => {
  const temporary = `${journalPath()}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(journal));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, journalPath());
  await syncRestoreDirectories();
};

export const beginLibraryRestore = async (id: string) => {
  await mkdir(appConfig.dataDir, { recursive: true });
  await mkdir(appConfig.storageDir, { recursive: true });
  if (await exists(journalPath())) {
    throw new Error("An earlier library restore still needs recovery. Restart Irulan before restoring again.");
  }
  const paths = restorePaths(id);
  const journal: RestoreJournal = {
    id,
    phase: "prepared",
    hadBooks: await exists(paths.books),
    hadDatabase: await exists(paths.database),
    hadBackup: await exists(paths.backup),
  };
  await writeJournal(journal);
  return journal;
};

export const commitLibraryRestore = async (journal: RestoreJournal) => {
  await syncRestoreDirectories();
  await writeJournal({ ...journal, phase: "committed" });
};

/** Called before opening SQLite or creating a new books directory at startup.
 * Before commit, roll back; after commit, only clean up the previous library.
 * Each step can be repeated if recovery itself is interrupted.
 */
export const recoverLibraryRestore = async () => {
  if (!(await exists(journalPath()))) return;
  const journal = journalSchema.parse(JSON.parse(await readFile(journalPath(), "utf8")));
  const paths = restorePaths(journal.id);

  if (journal.phase === "prepared") {
    const restore = async (current: string, previous: string, hadOriginal: boolean, database = false) => {
      const previousExists = await exists(previous);
      if (previousExists || !hadOriginal) {
        await rm(current, { force: true, recursive: true });
        if (database) {
          await rm(`${current}-wal`, { force: true });
          await rm(`${current}-shm`, { force: true });
        }
        if (previousExists) await rename(previous, current);
        await syncRestoreDirectories();
      } else if (!(await exists(current))) {
        // Do not let initialization silently replace a missing catalog with an
        // empty one when recovery cannot account for an original file.
        throw new Error(`Cannot recover the interrupted library restore: ${current} is missing.`);
      }
    };
    await restore(paths.books, paths.oldBooks, journal.hadBooks);
    await restore(paths.database, paths.oldDatabase, journal.hadDatabase, true);
    await restore(paths.backup, paths.oldBackup, journal.hadBackup, true);
  } else {
    // Cleanup must not erase the last recoverable copy if a committed library
    // was subsequently moved or damaged. Stop before deleting any originals.
    if (!(await exists(paths.database)) || !(await exists(paths.books))) {
      throw new Error("The committed restored library is missing files; recovery copies have been kept.");
    }
    await rm(paths.oldBooks, { force: true, recursive: true });
    await rm(paths.oldDatabase, { force: true });
    await rm(paths.oldBackup, { force: true });
  }
  await rm(paths.newDatabase, { force: true });
  await syncRestoreDirectories();
  await rm(journalPath(), { force: true });
  await rm(`${journalPath()}.tmp`, { force: true });
  await syncRestoreDirectories();
};
