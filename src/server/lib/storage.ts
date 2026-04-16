import { mkdir } from "node:fs/promises";
import path from "node:path";

import { appConfig } from "../config";

export const ensureStorageLayout = async () => {
  await mkdir(appConfig.dataDir, { recursive: true });
  await mkdir(path.join(appConfig.storageDir, "books"), { recursive: true });
};

export const bookDirectory = (bookId: string) =>
  path.join(appConfig.storageDir, "books", bookId);

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
