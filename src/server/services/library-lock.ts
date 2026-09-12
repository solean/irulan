let pending = Promise.resolve();

/**
 * Serialize operations that must keep the database's book rows and the book
 * files on disk in the same state. Staged imports are not visible to backups;
 * committed imports, deletions, backup snapshots, and restores use this lock.
 */
export const withLibraryFileLock = async <T>(operation: () => Promise<T>): Promise<T> => {
  const previous = pending;
  let release = () => {};
  pending = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
};
