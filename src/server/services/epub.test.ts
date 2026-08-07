import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, test } from "vitest";
import JSZip from "jszip";

import { extractEpubMetadata, prepareEpubReader, readEpubReaderAsset } from "./epub";

// This file builds its own fixture directories; `src/test/setup.ts`, run before this
// file's imports, keeps the app's own storage root in a temp directory.
const testDirectory = mkdtempSync(path.join(os.tmpdir(), "irulan-epub-tests-"));

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
  </metadata>
  <manifest>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
  </spine>
</package>`;

const CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter One</title></head>
  <body><p>Hello</p></body>
</html>`;

const buildEpubBytes = async (extraEntries: Record<string, string> = {}) => {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/content.opf", CONTENT_OPF);
  zip.file("OEBPS/chapter1.xhtml", CHAPTER);

  for (const [name, content] of Object.entries(extraEntries)) {
    zip.file(name, content);
  }

  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
};

/**
 * Write an EPUB whose archive really does carry a traversing entry name.
 *
 * JSZip's writer rewrites such names, so the bytes are patched afterwards. The
 * placeholder is chosen to be exactly as long as the hostile name, which keeps
 * every offset in the archive valid while replacing the name in both the local
 * header and the central directory.
 */
const writeEpubWithTraversingEntry = async (filePath: string) => {
  const placeholder = "zz/yy/evil.txt";
  const hostile = "../../evil.txt";
  expect(placeholder).toHaveLength(hostile.length);

  const bytes = await buildEpubBytes({ [placeholder]: "payload" });
  const patched = Buffer.from(bytes.toString("latin1").replaceAll(placeholder, hostile), "latin1");
  expect(patched).toHaveLength(bytes.length);

  writeFileSync(filePath, patched);
};

const makeCase = (name: string) => {
  const caseDirectory = path.join(testDirectory, name);
  rmSync(caseDirectory, { force: true, recursive: true });
  mkdirSync(caseDirectory, { recursive: true });

  return {
    caseDirectory,
    epubPath: path.join(caseDirectory, "original.epub"),
    readerDirectory: path.join(caseDirectory, "reader"),
  };
};

afterAll(() => {
  rmSync(testDirectory, { force: true, recursive: true });
});

describe("prepareEpubReader", () => {
  test("builds a manifest without unpacking the archive", async () => {
    const { epubPath, readerDirectory } = makeCase("plain");
    writeFileSync(epubPath, await buildEpubBytes());

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-plain");

    expect(manifest.title).toBe("Test Book");
    expect(manifest.author).toBe("Test Author");
    expect(manifest.sections).toHaveLength(1);
    expect(manifest.sections[0]?.href).toBe("OEBPS/chapter1.xhtml");

    // The whole point of serving from the zip: the reader directory holds the
    // manifest and nothing else, so a book costs its EPUB and a few hundred bytes.
    expect(readdirSync(readerDirectory)).toEqual(["manifest.json"]);
  });

  /**
   * yauzl refuses to enumerate an archive whose central directory carries a
   * ".." segment, so the file is rejected whole rather than per entry. That is
   * uniform now: importing the same file parses its metadata through the same
   * reader and fails the same way, so no such book can reach the library.
   */
  test("rejects an archive that carries a traversing entry name", async () => {
    const { caseDirectory, epubPath, readerDirectory } = makeCase("traversal");
    await writeEpubWithTraversingEntry(epubPath);

    await expect(extractEpubMetadata(epubPath)).rejects.toThrow(
      "This file is not a valid EPUB archive.",
    );
    await expect(
      prepareEpubReader(epubPath, readerDirectory, "book-traversal"),
    ).rejects.toThrow("This file is not a valid EPUB archive.");

    // Nothing may be written outside the reader directory, by any route.
    expect(existsSync(path.join(caseDirectory, "evil.txt"))).toBe(false);
    expect(existsSync(path.join(testDirectory, "evil.txt"))).toBe(false);
  });
});

describe("readEpubReaderAsset", () => {
  // This is the guard that actually faces untrusted input: the asset path comes
  // from the request URL, which nothing has sanitized on the way in.
  const epubPath = path.join(testDirectory, "asset-guard.epub");

  test("returns the entry bytes for an ordinary path", async () => {
    writeFileSync(epubPath, await buildEpubBytes());

    const bytes = await readEpubReaderAsset(epubPath, "OEBPS/chapter1.xhtml");

    expect(bytes?.toString("utf8")).toBe(CHAPTER);
  });

  test("treats an absolute-looking path as archive-relative", async () => {
    writeFileSync(epubPath, await buildEpubBytes());

    const bytes = await readEpubReaderAsset(epubPath, "/OEBPS/chapter1.xhtml");

    expect(bytes?.toString("utf8")).toBe(CHAPTER);
  });

  test("returns null for an entry the archive does not hold", async () => {
    writeFileSync(epubPath, await buildEpubBytes());

    expect(await readEpubReaderAsset(epubPath, "OEBPS/missing.xhtml")).toBeNull();
  });

  test("rejects paths that climb out of the archive root", async () => {
    writeFileSync(epubPath, await buildEpubBytes());

    for (const assetPath of [
      "../../../etc/passwd",
      "../secrets.txt",
      "OEBPS/../../../etc/passwd",
      "..",
      "",
    ]) {
      await expect(readEpubReaderAsset(epubPath, assetPath)).rejects.toThrow(
        "Invalid reader asset path.",
      );
    }
  });

  test("rejects an archive it cannot safely enumerate", async () => {
    const traversingPath = path.join(testDirectory, "asset-traversal.epub");
    await writeEpubWithTraversingEntry(traversingPath);

    await expect(readEpubReaderAsset(traversingPath, "evil.txt")).rejects.toThrow(
      "This file is not a valid EPUB archive.",
    );
  });
});
