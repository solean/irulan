// @vitest-environment happy-dom

import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, test } from "vitest";
import JSZip from "jszip";

import type { BookReaderSection } from "../../shared/types";
import { getCanonicalReaderText } from "../../web/lib/reader-location";
import { parseReaderMarkup, renderReaderDocument } from "../../web/lib/reader";
import { extractEpubReaderTextSections } from "./epub";

const testDirectory = mkdtempSync(path.join(os.tmpdir(), "irulan-epub-text-tests-"));
let caseCounter = 0;

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const CHAPTER_ONE = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Chapter One</title>
    <style>.hidden { display: none; }</style>
  </head>
  <body>
    <h1>Chapter   One</h1>
    <p>Alpha <em>brave</em>   new &amp; old world.</p>
    <script>hidden search text</script>
    <p>Second<br/>line<img src="../images/picture.png" alt="not searchable"/></p>
  </body>
</html>`;

const CHAPTER_TWO = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter Two</title></head>
  <body>
    <section>
      <p>Before <span>nested <strong>words</strong></span>.</p>
      <pre> spaced
 text </pre>
      <aside><p>Tail</p></aside>
      <custom>Fallback <i>text</i></custom>
    </section>
  </body>
</html>`;

const buildEpub = async (entries: Record<string, string>) => {
  caseCounter += 1;
  const filePath = path.join(testDirectory, `${caseCounter}.epub`);
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Search Fixture</dc:title>
    <dc:creator>Test Author</dc:creator>
  </metadata>
  <manifest>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`,
  );
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  writeFileSync(filePath, await zip.generateAsync({ type: "uint8array" }));
  return filePath;
};

const canonicalRenderedText = (markup: string, section: BookReaderSection) => {
  const rendered = renderReaderDocument({
    bookId: "book-search",
    document: parseReaderMarkup(markup),
    onInternalLinkClick: () => undefined,
    section,
  });
  const root = document.createElement("article");
  root.innerHTML = renderToStaticMarkup(createElement(Fragment, null, ...rendered));
  return getCanonicalReaderText(root);
};

afterAll(() => {
  rmSync(testDirectory, { force: true, recursive: true });
});

describe("extractEpubReaderTextSections", () => {
  test("matches the canonical text produced by the web renderer", async () => {
    const filePath = await buildEpub({
      "OEBPS/chapter1.xhtml": CHAPTER_ONE,
      "OEBPS/text/chapter2.xhtml": CHAPTER_TWO,
    });

    const sections = await extractEpubReaderTextSections(filePath);
    const sourceByHref: Record<string, string> = {
      "OEBPS/chapter1.xhtml": CHAPTER_ONE,
      "OEBPS/text/chapter2.xhtml": CHAPTER_TWO,
    };

    expect(sections.map(({ href, label, spineIndex }) => ({ href, label, spineIndex }))).toEqual([
      { href: "OEBPS/chapter1.xhtml", label: "Chapter One", spineIndex: 0 },
      { href: "OEBPS/text/chapter2.xhtml", label: "Chapter Two", spineIndex: 1 },
    ]);

    for (const section of sections) {
      const markup = sourceByHref[section.href];
      if (!markup) throw new Error(`Missing source markup for ${section.href}.`);
      const readerSection: BookReaderSection = {
        id: section.id,
        href: section.href,
        label: section.label,
        textLength: section.textLength,
        url: `/api/books/book-search/read/${section.href}`,
      };
      expect(section.text).toBe(canonicalRenderedText(markup, readerSection));
    }

    expect(sections[0]?.text).toContain("Alpha brave new & old world.");
    expect(sections[0]?.text).not.toContain("hidden search text");
    expect(sections[0]?.text).not.toContain("not searchable");
  });

  test("fails explicitly when a linear spine section is missing", async () => {
    const filePath = await buildEpub({ "OEBPS/chapter1.xhtml": CHAPTER_ONE });

    await expect(extractEpubReaderTextSections(filePath)).rejects.toThrow(
      'The EPUB reader section "OEBPS/text/chapter2.xhtml" is missing.',
    );
  });
});
