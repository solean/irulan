// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import type { ReaderTextLocation } from "../../shared/types";
import { api } from "./api";
import { loadReaderProgress, saveReaderProgress } from "./reader-progress";
import { setStoredReaderProgress } from "./storage";

vi.mock("./api", () => ({ api: { getReaderProgress: vi.fn(), saveReaderProgress: vi.fn() } }));
const location: ReaderTextLocation = { sectionHref: "chapter.xhtml", textVersion: 1, offset: 12, prefix: "Opening text", suffix: "Continues" };
const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.resetAllMocks();
});

test("resumes durable progress on a new origin and prefers it to legacy browser data", async () => {
  vi.mocked(api.getReaderProgress).mockResolvedValue(location);
  expect(await loadReaderProgress("fresh-origin")).toEqual(location);
  setStoredReaderProgress("old-origin", { ...location, offset: 0 });
  expect(await loadReaderProgress("old-origin")).toEqual(location);
  expect(api.saveReaderProgress).not.toHaveBeenCalled();
});

test("migrates legacy data only through the insert-only endpoint and uses its returned location", async () => {
  setStoredReaderProgress("migrate", { ...location, offset: 0 });
  vi.mocked(api.getReaderProgress).mockResolvedValue(null);
  vi.mocked(api.saveReaderProgress).mockResolvedValue(location);
  expect(await loadReaderProgress("migrate")).toEqual(location);
  expect(api.saveReaderProgress).toHaveBeenCalledWith("migrate", { ...location, offset: 0 }, true);
});

test("serializes page turns and waits for the last save before reading on remount", async () => {
  let finishFirst!: (value: ReaderTextLocation) => void;
  vi.mocked(api.saveReaderProgress)
    .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
    .mockResolvedValueOnce({ ...location, offset: 25 });
  vi.mocked(api.getReaderProgress).mockResolvedValue({ ...location, offset: 25 });
  const first = saveReaderProgress("ordered", location);
  const second = saveReaderProgress("ordered", { ...location, offset: 25 });
  const resumed = loadReaderProgress("ordered");
  await vi.waitFor(() => expect(api.saveReaderProgress).toHaveBeenCalledTimes(1));
  expect(api.getReaderProgress).not.toHaveBeenCalled();
  finishFirst(location);
  await Promise.all([first, second]);
  expect(await resumed).toEqual({ ...location, offset: 25 });
  expect(api.saveReaderProgress).toHaveBeenNthCalledWith(2, "ordered", { ...location, offset: 25 });
});

test("a failed durable read does not migrate potentially stale browser data", async () => {
  setStoredReaderProgress("failure", location);
  vi.mocked(api.getReaderProgress).mockRejectedValue(new Error("Unavailable"));
  await expect(loadReaderProgress("failure")).rejects.toThrow("Unavailable");
  expect(api.saveReaderProgress).not.toHaveBeenCalled();
});
