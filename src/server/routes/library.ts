import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { Hono } from "hono";

import { AppError } from "../errors";
import {
  createLibraryBackup,
  MAX_LIBRARY_BACKUP_ARCHIVE_BYTES,
  restoreLibraryBackup,
  storeLibraryBackupUpload,
} from "../services/library-backup";

export const libraryRoutes = new Hono();

libraryRoutes.get("/backup", async () => {
  const backup = await createLibraryBackup();
  const file = await stat(backup.filePath);
  const source = createReadStream(backup.filePath);
  source.once("close", () => {
    void backup.cleanup().catch((error) => {
      console.warn("Could not remove the temporary library backup.", error);
    });
  });

  return new Response(Readable.toWeb(source) as ReadableStream<Uint8Array>, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${backup.fileName}"`,
      "Content-Length": String(file.size),
      "Content-Type": "application/zip",
    },
  });
});

libraryRoutes.post("/restore", async (c) => {
  const contentLength = c.req.header("Content-Length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new AppError(400, "The backup file size is invalid.");
    }
    if (parsedLength > MAX_LIBRARY_BACKUP_ARCHIVE_BYTES) {
      throw new AppError(413, "The library backup file is too large.");
    }
  }

  const body = c.req.raw.body;
  if (!body) throw new AppError(400, "Choose a library backup file to restore.");
  const uploadPath = await storeLibraryBackupUpload(
    Readable.from(body as AsyncIterable<Uint8Array>),
  );
  try {
    return c.json({ restore: await restoreLibraryBackup(uploadPath) });
  } finally {
    await rm(uploadPath, { force: true });
  }
});
