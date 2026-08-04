import type { ImportResult } from "../../shared/types";

export const IMPORT_BATCH_SIZE = 20;
export const INVALID_IMPORT_FILES_MESSAGE = "Only EPUB files are supported.";

export const isFileDrag = (dataTransfer: DataTransfer | null) =>
  Array.from(dataTransfer?.items ?? []).some((item) => item.kind === "file") ||
  Array.from(dataTransfer?.types ?? []).includes("Files");

export const isEpubFile = (file: File) =>
  file.name.toLowerCase().endsWith(".epub") || file.type === "application/epub+zip";

export const getImportableFiles = (files: Iterable<File>) => Array.from(files).filter(isEpubFile);

export const getImportToastVariant = (
  status: ImportResult["status"],
): "success" | "warning" | "error" => {
  if (status === "imported") return "success";
  if (status === "duplicate") return "warning";
  return "error";
};

export const getImportToastTitle = (status: ImportResult["status"]) => {
  if (status === "imported") return "Imported";
  if (status === "duplicate") return "Already in library";
  return "Import failed";
};
