import type { ReaderTextLocation } from "../../shared/types";
import { api } from "./api";
import { getStoredReaderProgress, setStoredReaderProgress } from "./storage";

// Serialize writes and reads per book, including across reader mounts. A slow
// request must not overwrite a later page turn or race the initial resume read.
const pending = new Map<string, Promise<unknown>>();
const enqueue = <T>(bookId: string, operation: () => Promise<T>): Promise<T> => {
  const result = (pending.get(bookId) ?? Promise.resolve()).catch(() => {}).then(operation);
  pending.set(bookId, result);
  void result.finally(() => {
    if (pending.get(bookId) === result) pending.delete(bookId);
  }).catch(() => {});
  return result;
};

export const loadReaderProgress = (bookId: string) => enqueue(bookId, async () => {
  const saved = await api.getReaderProgress(bookId);
  if (saved) return saved;
  const legacy = getStoredReaderProgress(bookId);
  // The server's insert-only migration returns the existing location if another
  // reader has already saved one since our GET.
  return legacy ? api.saveReaderProgress(bookId, legacy, true) : null;
});

export const saveReaderProgress = (bookId: string, location: ReaderTextLocation) => {
  setStoredReaderProgress(bookId, location);
  return enqueue(bookId, () => api.saveReaderProgress(bookId, location));
};
