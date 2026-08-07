import { describe, expect, test } from "vitest";

import type { BookReaderSection } from "../../shared/types";
import {
  buildReaderAssetUrl,
  createReaderAssetSection,
  getReaderLinkTarget,
  resolveReaderSectionLabels,
} from "./reader";

// The app is same-origin everywhere (Vite proxies /api in dev, the server serves
// the client in production and under Electron), so one origin stands in for all
// of them. Passing it explicitly keeps these cases out of a DOM environment.
const APP_ORIGIN = "http://localhost:5173";
const BOOK_ID = "book-1";

const section: BookReaderSection = {
  id: "c1",
  href: "OEBPS/chapter1.xhtml",
  label: "Chapter One",
  url: "/api/books/book-1/read/OEBPS/chapter1.xhtml",
};

const resolve = (rawHref: string | null) =>
  getReaderLinkTarget(BOOK_ID, section, rawHref, APP_ORIGIN);

describe("getReaderLinkTarget", () => {
  test("rejects an anchor with nothing to follow", () => {
    expect(resolve(null)).toEqual({ kind: "invalid" });
    expect(resolve("")).toEqual({ kind: "invalid" });
    expect(resolve("   ")).toEqual({ kind: "invalid" });
  });

  test("refuses javascript: however it is spelled", () => {
    // EPUB markup is untrusted, and this href would otherwise reach an <a href>.
    expect(resolve("javascript:alert(1)")).toEqual({ kind: "invalid" });
    expect(resolve("JavaScript:alert(1)")).toEqual({ kind: "invalid" });
    expect(resolve("  javascript:alert(1)")).toEqual({ kind: "invalid" });
  });

  test("passes mail and telephone links through untouched", () => {
    expect(resolve("mailto:reader@example.com")).toEqual({
      kind: "external",
      href: "mailto:reader@example.com",
    });
    expect(resolve("MailTo:reader@example.com")).toEqual({
      kind: "external",
      href: "MailTo:reader@example.com",
    });
    expect(resolve("tel:+15551234567")).toEqual({
      kind: "external",
      href: "tel:+15551234567",
    });
  });

  test("treats another origin as external", () => {
    expect(resolve("https://example.com/page")).toEqual({
      kind: "external",
      href: "https://example.com/page",
    });
    // Protocol-relative hrefs inherit the scheme but not the host.
    expect(resolve("//example.com/page")).toEqual({
      kind: "external",
      href: "http://example.com/page",
    });
  });

  test("treats a same-origin URL outside the reader as external", () => {
    // Following this inside the reader would render an app page as book content.
    expect(resolve("/settings")).toEqual({
      kind: "external",
      href: "http://localhost:5173/settings",
    });
  });

  test("treats another book's reader URL as external", () => {
    expect(resolve("/api/books/book-2/read/OEBPS/chapter1.xhtml")).toEqual({
      kind: "external",
      href: "http://localhost:5173/api/books/book-2/read/OEBPS/chapter1.xhtml",
    });
  });

  test("resolves a sibling section relative to the current one", () => {
    expect(resolve("chapter2.xhtml")).toEqual({
      kind: "internal",
      href: "OEBPS/chapter2.xhtml",
      anchor: null,
    });
    expect(resolve("  chapter2.xhtml  ")).toEqual({
      kind: "internal",
      href: "OEBPS/chapter2.xhtml",
      anchor: null,
    });
  });

  test("resolves a path that climbs within the book", () => {
    expect(resolve("../styles/main.css")).toEqual({
      kind: "internal",
      href: "styles/main.css",
      anchor: null,
    });
  });

  test("stops treating a link as internal once it climbs past the book", () => {
    // Three levels up leaves the reader prefix entirely, so this is a same-origin
    // app URL rather than a section of this book.
    expect(resolve("../../../evil.html")).toEqual({
      kind: "external",
      href: "http://localhost:5173/api/books/evil.html",
    });
  });

  test("keeps a fragment-only link on the current section", () => {
    expect(resolve("#part-two")).toEqual({
      kind: "internal",
      href: "OEBPS/chapter1.xhtml",
      anchor: "part-two",
    });
  });

  test("decodes both the section path and the anchor", () => {
    expect(resolve("chapter%20two.xhtml#sec%20two")).toEqual({
      kind: "internal",
      href: "OEBPS/chapter two.xhtml",
      anchor: "sec two",
    });
  });

  test("rejects an href the URL parser cannot resolve", () => {
    expect(resolve("http://")).toEqual({ kind: "invalid" });
    expect(resolve("http://[invalid")).toEqual({ kind: "invalid" });
  });

  test("rejects a reader path carrying a broken percent escape", () => {
    // Decoding this throws; the link must not fall through as a usable target.
    expect(resolve("bad%E0%A4%A.xhtml")).toEqual({ kind: "invalid" });
  });

  test("compares against the origin it is given", () => {
    const target = getReaderLinkTarget(
      BOOK_ID,
      section,
      "https://reader.example/api/books/book-1/read/OEBPS/chapter2.xhtml",
      "https://reader.example",
    );

    expect(target).toEqual({
      kind: "internal",
      href: "OEBPS/chapter2.xhtml",
      anchor: null,
    });
  });
});

describe("reader asset sections", () => {
  test("percent-encodes each segment of an asset URL", () => {
    expect(buildReaderAssetUrl(BOOK_ID, "OEBPS/text/chapter one & two.xhtml")).toBe(
      "/api/books/book-1/read/OEBPS/text/chapter%20one%20%26%20two.xhtml",
    );
  });

  test("builds a section a link target can be resolved against", () => {
    const asset = createReaderAssetSection(BOOK_ID, "OEBPS/notes/end_notes.xhtml");

    expect(asset).toEqual({
      id: "asset:OEBPS/notes/end_notes.xhtml",
      href: "OEBPS/notes/end_notes.xhtml",
      label: "End notes",
      url: "/api/books/book-1/read/OEBPS/notes/end_notes.xhtml",
    });

    // The asset URL and the link resolver have to agree, or following a link into
    // a section the manifest never listed would bounce straight back out.
    expect(getReaderLinkTarget(BOOK_ID, asset, "#note-3", APP_ORIGIN)).toEqual({
      kind: "internal",
      href: "OEBPS/notes/end_notes.xhtml",
      anchor: "note-3",
    });
  });

  test("labels an href with no usable filename", () => {
    expect(createReaderAssetSection(BOOK_ID, "").label).toBe("Linked section");
  });
});

describe("resolveReaderSectionLabels", () => {
  const withLabels = (...labels: string[]): BookReaderSection[] =>
    labels.map((label, index) => ({
      id: `s${index}`,
      href: `OEBPS/${index}.xhtml`,
      label,
      url: `/api/books/book-1/read/OEBPS/${index}.xhtml`,
    }));

  test("keeps labels that say something", () => {
    expect(resolveReaderSectionLabels(withLabels("Preface", "Chapter One"), "A Book")).toEqual([
      "Preface",
      "Chapter One",
    ]);
  });

  test("numbers a section labelled with the book title", () => {
    // Many EPUBs stamp every spine item with the book's own title.
    expect(
      resolveReaderSectionLabels(withLabels("the coldest winter", "Chapter One"), "The Coldest Winter"),
    ).toEqual(["Section 1", "Chapter One"]);
  });

  test("numbers a section labelled with the title's lead segment", () => {
    expect(
      resolveReaderSectionLabels(
        withLabels("The Coldest Winter", "Chapter One"),
        "The Coldest Winter: America and the Korean War",
      ),
    ).toEqual(["Section 1", "Chapter One"]);
  });

  test("numbers a blank label", () => {
    expect(resolveReaderSectionLabels(withLabels("   ", "Chapter One"), "A Book")).toEqual([
      "Section 1",
      "Chapter One",
    ]);
  });

  test("numbers every repeat after the first", () => {
    expect(
      resolveReaderSectionLabels(withLabels("Notes", "Notes", "notes", "Index"), "A Book"),
    ).toEqual(["Notes", "Section 2", "Section 3", "Index"]);
  });

  test("trims a label it keeps", () => {
    expect(resolveReaderSectionLabels(withLabels("  Chapter One  "), "A Book")).toEqual([
      "Chapter One",
    ]);
  });
});
