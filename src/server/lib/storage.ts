import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { appConfig } from "../config";

export const ensureStorageLayout = async () => {
  await mkdir(appConfig.dataDir, { recursive: true });
  await mkdir(path.join(appConfig.storageDir, "books"), { recursive: true });
};

export const bookDirectory = (bookId: string) =>
  path.join(appConfig.storageDir, "books", bookId);

export const readerDirectory = (bookId: string) =>
  path.join(bookDirectory(bookId), "reader");

/**
 * Holding area for a book's files while its rows are being deleted, so a failed
 * transaction can move them back. Created on demand by the first delete.
 */
export const trashDirectory = () => path.join(appConfig.storageDir, ".trash");

const isMissing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

/**
 * Remove everything left in the trash directory and report how much was removed.
 *
 * Once a delete commits, nothing in the database points at the trashed files, so
 * a crash between the commit and the cleanup — or a cleanup that simply fails —
 * strands them where no later request would ever look. Startup is the safe place
 * to sweep: the server is not accepting requests yet, so no delete can be
 * mid-flight waiting to restore its files from here.
 *
 * A directory that refuses to go away must not stop the app from booting, so
 * failures are logged per entry and the sweep continues.
 */
export const sweepTrash = async () => {
  const root = trashDirectory();
  let entries: string[];

  try {
    entries = await readdir(root);
  } catch (error) {
    if (!isMissing(error)) {
      console.error("Could not read the trash directory.", error);
    }
    return 0;
  }

  let removed = 0;

  for (const entry of entries) {
    try {
      await rm(path.join(root, entry), { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      console.error(`Could not remove leftover book files in .trash/${entry}.`, error);
    }
  }

  if (removed > 0) {
    console.log(
      `Swept ${removed} leftover book ${removed === 1 ? "directory" : "directories"} from the trash.`,
    );
  }

  return removed;
};

/**
 * Remove reader content unpacked by an older build.
 *
 * Reader prep used to extract every zip entry beside the manifest, doubling a
 * book's uncompressed footprint for assets that are now read straight from the
 * EPUB. Nothing looks in these directories any more.
 *
 * Sweeping at startup rather than the next time each book is opened is what
 * makes the space come back at all: a library nobody re-reads would otherwise
 * keep every stale copy forever. Like the trash sweep, this runs before the
 * server accepts requests and never blocks boot.
 */
export const sweepExtractedReaderContent = async () => {
  const root = path.join(appConfig.storageDir, "books");
  let bookIds: string[];

  try {
    bookIds = await readdir(root);
  } catch (error) {
    if (!isMissing(error)) {
      console.error("Could not read the books directory.", error);
    }
    return 0;
  }

  let removed = 0;

  for (const bookId of bookIds) {
    const extracted = path.join(readerDirectory(bookId), "content");

    try {
      await stat(extracted);
    } catch {
      continue;
    }

    try {
      await rm(extracted, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      console.error(`Could not remove extracted reader content for ${bookId}.`, error);
    }
  }

  if (removed > 0) {
    console.log(
      `Removed extracted reader content for ${removed} ${removed === 1 ? "book" : "books"}.`,
    );
  }

  return removed;
};

export const coverContentType = (coverPath: string) => {
  const ext = path.extname(coverPath).toLowerCase();

  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
};

export const readerAssetContentType = (assetPath: string) => {
  const ext = path.extname(assetPath).toLowerCase();

  switch (ext) {
    case ".xhtml":
      return "application/xhtml+xml; charset=utf-8";
    case ".xml":
    case ".opf":
    case ".ncx":
      return "application/xml; charset=utf-8";
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".mp3":
      return "audio/mpeg";
    case ".mp4":
      return "video/mp4";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    default:
      return "application/octet-stream";
  }
};
