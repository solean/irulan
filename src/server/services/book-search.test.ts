import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import JSZip from "jszip";
import { beforeEach, describe, expect, test } from "vitest";

import { app } from "../app";
import * as client from "../db/client";
import * as schema from "../db/schema";
import { bookDirectory } from "../lib/storage";
import { ensureBookSearchIndex, searchBook } from "./book-search";

await client.initializeDatabase();
client.ensureSchema();

const BOOK_ID = "search-book";
const EPUB_PATH = path.join(bookDirectory(BOOK_ID), "original.epub");

const buildSearchEpub = async () => {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles>
</container>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Search Book</dc:title><dc:creator>Test Author</dc:creator>
  </metadata>
  <manifest>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="chapter3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine>
</package>`,
  );
  zip.file(
    "OEBPS/chapter1.xhtml",
    `<html><head><title>Arrakis</title></head><body>
      <p>Melange powers travel across the desert.</p>
      <script>hidden melange instructions</script>
    </body></html>`,
  );
  zip.file(
    "OEBPS/chapter2.xhtml",
    `<html><head><title>Café Chapter</title></head><body>
      <p>The café serves melange beside the river.</p>
    </body></html>`,
  );
  zip.file(
    "OEBPS/chapter3.xhtml",
    "<html><head><title>Appendix</title></head><body><p>Unrelated material.</p></body></html>",
  );
  return zip.generateAsync({ type: "uint8array" });
};

const request = async (url: string) => {
  const response = await app.fetch(new Request(`http://127.0.0.1${url}`));
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
};

beforeEach(async () => {
  client.db.delete(schema.books).run();
  rmSync(bookDirectory(BOOK_ID), { force: true, recursive: true });
  mkdirSync(bookDirectory(BOOK_ID), { recursive: true });
  writeFileSync(EPUB_PATH, await buildSearchEpub());
  client.db
    .insert(schema.books)
    .values({
      id: BOOK_ID,
      title: "Search Book",
      author: "Test Author",
      filePath: EPUB_PATH,
      coverPath: null,
      fileHash: "search-hash",
      sourceFilename: "search.epub",
      fileSizeBytes: 1,
      importedAt: new Date(),
      readStatus: "unread",
      rating: null,
    })
    .run();
});

describe("book search indexing and queries", () => {
  test("lazily indexes the complete spine and returns stable ranges in spine order", async () => {
    const page = await searchBook(BOOK_ID, { query: "melange" });

    expect(page.total).toBe(2);
    expect(page.results.map(({ sectionLabel, spineIndex }) => ({ sectionLabel, spineIndex }))).toEqual([
      { sectionLabel: "Arrakis", spineIndex: 0 },
      { sectionLabel: "Café Chapter", spineIndex: 1 },
    ]);
    expect(client.db.select().from(schema.readerSectionText).all()).toHaveLength(3);

    const textByHref = new Map(
      client.db
        .select({ href: schema.readerSectionText.href, text: schema.readerSectionText.text })
        .from(schema.readerSectionText)
        .all()
        .map(({ href, text }) => [href, text]),
    );
    for (const result of page.results) {
      const text = textByHref.get(result.sectionHref);
      expect(text?.slice(result.range.offset, result.range.endOffset)).toBe(result.range.exact);
      expect(result.snippet).toContain(result.range.exact);
    }

    rmSync(EPUB_PATH);
    const cached = await searchBook(BOOK_ID, { query: "river" });
    expect(cached.results[0]?.sectionLabel).toBe("Café Chapter");
  });

  test("uses plain AND terms rather than exposing FTS query operators", async () => {
    const operatorLike = await searchBook(BOOK_ID, { query: "melange OR hidden" });
    const punctuationOnly = await searchBook(BOOK_ID, { query: "!!!" });

    expect(operatorLike.total).toBe(0);
    expect(punctuationOnly.total).toBe(0);
  });

  test("uses Unicode tokenization and returns the exact accented source quote", async () => {
    const page = await searchBook(BOOK_ID, { query: "cafe" });

    expect(page.total).toBe(1);
    expect(page.results[0]?.range.exact).toBe("café");
  });

  test("keeps the previous complete index when rebuilding cannot read the EPUB", async () => {
    await ensureBookSearchIndex(BOOK_ID);
    client.db
      .update(schema.readerSectionText)
      .set({ textVersion: 0 })
      .where(eq(schema.readerSectionText.bookId, BOOK_ID))
      .run();
    rmSync(EPUB_PATH);

    await expect(ensureBookSearchIndex(BOOK_ID)).rejects.toThrow(
      "This file is not a valid EPUB archive.",
    );

    expect(client.db.select().from(schema.readerSectionText).all()).toHaveLength(3);
    const indexed = client.db.get<{ total: number }>(sql`
      SELECT count(*) AS total
      FROM reader_section_fts
      WHERE reader_section_fts MATCH 'melange'
    `);
    expect(indexed?.total).toBe(2);
  });
});

describe("book search API", () => {
  test("returns the paginated search contract", async () => {
    const response = await request(`/api/books/${BOOK_ID}/search?q=melange&limit=1`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ query: "melange", total: 2, offset: 0, limit: 1 });
    expect(response.body.results).toHaveLength(1);
  });

  test("validates query text and pagination", async () => {
    expect((await request(`/api/books/${BOOK_ID}/search`)).status).toBe(400);
    expect((await request(`/api/books/${BOOK_ID}/search?q=${"a".repeat(201)}`)).status).toBe(400);
    expect((await request(`/api/books/${BOOK_ID}/search?q=melange&limit=51`)).status).toBe(400);
  });

  test("returns 404 for a missing book", async () => {
    const response = await request("/api/books/missing/search?q=melange");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Book not found." });
  });
});
