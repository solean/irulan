// @vitest-environment happy-dom

import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

import { READER_TEXT_VERSION, type ReaderTextLocation } from "../../shared/types";
import { getStoredReaderProgress, setStoredReaderProgress } from "./storage";

const BOOK_ID = "reader-progress-book";
const STORAGE_KEY = `ebook-manager-reader-progress:${BOOK_ID}`;
const LOCATION: ReaderTextLocation = {
  sectionHref: "OEBPS/chapter-2.xhtml",
  textVersion: READER_TEXT_VERSION,
  offset: 137,
  prefix: "text before the saved point",
  suffix: "text after the saved point",
};

const storedValues = new Map<string, string>();
const storage: Storage = {
  get length() {
    return storedValues.size;
  },
  clear: () => storedValues.clear(),
  getItem: (key) => storedValues.get(key) ?? null,
  key: (index) => Array.from(storedValues.keys())[index] ?? null,
  removeItem: (key) => {
    storedValues.delete(key);
  },
  setItem: (key, value) => {
    storedValues.set(key, value);
  },
};

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", storage);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("reader progress storage", () => {
  test("persists a pagination-independent text location", () => {
    setStoredReaderProgress(BOOK_ID, LOCATION);

    expect(getStoredReaderProgress(BOOK_ID)).toEqual(LOCATION);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).not.toHaveProperty("page");
  });

  test.each([
    ["legacy page progress", { section: LOCATION.sectionHref, page: 4 }],
    ["unknown text version", { ...LOCATION, textVersion: 2 }],
    ["non-canonical context", { ...LOCATION, prefix: "text  before" }],
    ["missing quote context", { ...LOCATION, prefix: "", suffix: "" }],
  ])("ignores %s", (_name, stored) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    expect(getStoredReaderProgress(BOOK_ID)).toBeNull();
  });
});
