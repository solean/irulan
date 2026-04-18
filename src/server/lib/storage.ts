import { mkdir } from "node:fs/promises";
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
