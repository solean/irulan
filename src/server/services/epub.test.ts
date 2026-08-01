import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import JSZip from "jszip";

const testDirectory = mkdtempSync(path.join(os.tmpdir(), "irulan-epub-tests-"));
process.env.EBOOK_DATA_DIR = path.join(testDirectory, "data");
process.env.EBOOK_STORAGE_DIR = path.join(testDirectory, "storage");

// Dynamic: `appConfig` snapshots the environment at module evaluation, so these modules
// must not be hoisted above the storage overrides set immediately above.
const { prepareEpubReader, resolveEpubReaderAssetPath } = await import("./epub");

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
  test("extracts a well-formed EPUB into readable sections", async () => {
    const { epubPath, readerDirectory } = makeCase("plain");
    writeFileSync(epubPath, await buildEpubBytes());

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-plain");

    expect(manifest.title).toBe("Test Book");
    expect(manifest.author).toBe("Test Author");
    expect(manifest.sections).toHaveLength(1);
    expect(manifest.sections[0]?.href).toBe("OEBPS/chapter1.xhtml");
    expect(existsSync(path.join(readerDirectory, "content", "OEBPS", "chapter1.xhtml"))).toBe(true);
  });

  test("stays readable when the archive carries a traversing entry name", async () => {
    const { caseDirectory, epubPath, readerDirectory } = makeCase("traversal");
    await writeEpubWithTraversingEntry(epubPath);

    // The book must open. Aborting the extraction here would report a readable
    // EPUB as invalid, and the reader directory has already been cleared by then.
    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-traversal");
    expect(manifest.sections).toHaveLength(1);

    // Nothing may be written outside the reader directory, by any route.
    expect(existsSync(path.join(caseDirectory, "evil.txt"))).toBe(false);
    expect(existsSync(path.join(testDirectory, "evil.txt"))).toBe(false);
    expect(existsSync(path.join(readerDirectory, "..", "evil.txt"))).toBe(false);
  });

  test("serves a section from the extracted content", async () => {
    const { epubPath, readerDirectory } = makeCase("serve");
    writeFileSync(epubPath, await buildEpubBytes());
    await prepareEpubReader(epubPath, readerDirectory, "book-serve");

    const assetPath = resolveEpubReaderAssetPath(readerDirectory, "OEBPS/chapter1.xhtml");

    expect(existsSync(assetPath)).toBe(true);
    expect(assetPath.startsWith(path.join(readerDirectory, "content"))).toBe(true);
  });
});

describe("resolveEpubReaderAssetPath", () => {
  // This is the guard that actually faces untrusted input: the asset path comes
  // from the request URL, which nothing has sanitized on the way in.
  const readerDirectory = path.join(testDirectory, "asset-guard", "reader");

  test("rejects paths that climb out of the reader directory", () => {
    for (const assetPath of [
      "../../../etc/passwd",
      "../secrets.txt",
      "OEBPS/../../../etc/passwd",
      "..",
    ]) {
      expect(() => resolveEpubReaderAssetPath(readerDirectory, assetPath)).toThrow(
        "Invalid reader asset path.",
      );
    }
  });

  test("rejects an empty path", () => {
    expect(() => resolveEpubReaderAssetPath(readerDirectory, "")).toThrow(
      "Invalid reader asset path.",
    );
  });

  test("keeps an absolute-looking path inside the reader directory", () => {
    const resolved = resolveEpubReaderAssetPath(readerDirectory, "/OEBPS/chapter1.xhtml");

    expect(resolved).toBe(path.join(readerDirectory, "content", "OEBPS", "chapter1.xhtml"));
  });

  test("allows ordinary nested asset paths", () => {
    const resolved = resolveEpubReaderAssetPath(readerDirectory, "OEBPS/images/cover.jpg");

    expect(resolved).toBe(path.join(readerDirectory, "content", "OEBPS", "images", "cover.jpg"));
  });
});
