// @vitest-environment happy-dom

import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

import { READER_TEXT_VERSION, type ReaderTextLocation } from "../../shared/types";
import {
  getStoredReaderFont,
  getStoredReaderFontScale,
  getStoredReaderProgress,
  getStoredReaderSpacing,
  getStoredReaderTone,
  setStoredReaderFont,
  setStoredReaderFontScale,
  setStoredReaderProgress,
  setStoredReaderSpacing,
  setStoredReaderTone,
} from "./storage";

const BOOK_ID = "reader-progress-book";
const STORAGE_KEY = `ebook-manager-reader-progress:${BOOK_ID}`;
const READER_FONT_KEY = "ebook-manager-reader-font";
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
  delete window.irulan;
});

afterAll(() => {
  delete window.irulan;
  vi.unstubAllGlobals();
});

describe("reader font storage", () => {
  test("migrates the removed Palatino option to Iowan", () => {
    localStorage.setItem(READER_FONT_KEY, "palatino");

    expect(getStoredReaderFont()).toBe("iowan");
    expect(localStorage.getItem(READER_FONT_KEY)).toBe("iowan");
  });
});

describe("reader appearance storage", () => {
  test("restores preferences injected by the Electron shell when local storage is empty", () => {
    window.irulan = {
      readerPreferences: {
        tone: "night",
        fontScale: 1.15,
        fontFamily: "literata",
        lineSpacing: "roomy",
      },
    } as IrulanBridge;

    expect(getStoredReaderTone()).toBe("night");
    expect(getStoredReaderFontScale()).toBe(1.15);
    expect(getStoredReaderFont()).toBe("literata");
    expect(getStoredReaderSpacing()).toBe("roomy");
  });

  test("mirrors preference changes to local storage and the Electron shell", () => {
    const setReaderPreferences = vi.fn(() => Promise.resolve());
    window.irulan = { setReaderPreferences } as unknown as IrulanBridge;

    setStoredReaderTone("sepia");
    setStoredReaderFontScale(1.05);
    setStoredReaderFont("atkinson");
    setStoredReaderSpacing("compact");

    expect(setReaderPreferences.mock.calls).toEqual([
      [{ tone: "sepia" }],
      [{ fontScale: 1.05 }],
      [{ fontFamily: "atkinson" }],
      [{ lineSpacing: "compact" }],
    ]);
    expect(localStorage.getItem("ebook-manager-reader-tone")).toBe("sepia");
    expect(localStorage.getItem("ebook-manager-reader-font-scale")).toBe("1.05");
    expect(localStorage.getItem(READER_FONT_KEY)).toBe("atkinson");
    expect(localStorage.getItem("ebook-manager-reader-spacing")).toBe("compact");
  });
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
