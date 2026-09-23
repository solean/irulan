import type { ImportResult } from "../../shared/types";
import type { ToastInput } from "../hooks/use-toast";
import { numberFormatter } from "./format";

export const IMPORT_BATCH_SIZE = 20;
export const INVALID_IMPORT_FILES_MESSAGE = "Only EPUB files are supported.";

export const isFileDrag = (dataTransfer: DataTransfer | null) =>
  Array.from(dataTransfer?.items ?? []).some((item) => item.kind === "file") ||
  Array.from(dataTransfer?.types ?? []).includes("Files");

export const isEpubFile = (file: File) =>
  file.name.toLowerCase().endsWith(".epub") || file.type === "application/epub+zip";

export const getImportableFiles = (files: Iterable<File>) => Array.from(files).filter(isEpubFile);

const countLabel = (count: number, one: string, many: string) =>
  `${numberFormatter.format(count)} ${count === 1 ? one : many}`;

/** One toast for a whole import, however many files it covered. */
export const getImportSummaryToast = (results: ImportResult[]): ToastInput => {
  if (results.length === 1) {
    const [result] = results;
    if (result.status === "imported") {
      return { title: "Imported", description: result.message, variant: "success" };
    }
    if (result.status === "duplicate") {
      return { title: "Already in library", description: result.message, variant: "warning" };
    }
    return { title: "Import failed", description: result.message, variant: "error" };
  }

  const imported = results.filter((result) => result.status === "imported").length;
  const duplicates = results.filter((result) => result.status === "duplicate").length;
  const failures = results.filter((result) => result.status === "failed");
  const details = [
    duplicates > 0 ? `${countLabel(duplicates, "book was", "books were")} already in your library.` : "",
    failures.length === 1 ? `1 file could not be imported: ${failures[0].message}` : "",
    failures.length > 1
      ? `${countLabel(failures.length, "file", "files")} could not be imported. First error: ${failures[0].message}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (imported === results.length) {
    return { title: `Imported ${countLabel(imported, "book", "books")}`, variant: "success" };
  }
  if (imported > 0) {
    return {
      title: `Imported ${numberFormatter.format(imported)} of ${countLabel(results.length, "book", "books")}`,
      description: details,
      variant: "warning",
    };
  }
  if (failures.length === 0) {
    return { title: "Already in library", description: details, variant: "warning" };
  }
  return { title: "Import failed", description: details, variant: "error" };
};
