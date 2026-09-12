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

/** An XHTML document with a `<title>`, which is what most spine items carry. */
const chapter = (title: string, body = "<p>Hello</p>") => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${title}</title></head>
  <body>${body}</body>
</html>`;

/** An XHTML document with no `<title>`, so label inference has to look further. */
const untitledChapter = (body = "<p>Hello</p>") => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head></head>
  <body>${body}</body>
</html>`;

const CHAPTER = chapter("Chapter One");

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/**
 * The parts of an EPUB a test wants to vary, as raw XML.
 *
 * Real EPUBs differ in exactly these fragments — which metadata elements exist,
 * how the cover is declared, whether navigation is an EPUB 3 `nav` document or
 * an EPUB 2 NCX — so the fixtures stay literal rather than modelling a package
 * document in TypeScript and re-serializing it.
 */
type EpubSpec = {
  /** Raw XML inside `<metadata>`. */
  metadata?: string;
  /** Raw `<item>` elements inside `<manifest>`. */
  manifest?: string;
  /** Extra attributes on `<spine>`, e.g. `toc="ncx"`. */
  spineAttributes?: string;
  /** Raw `<itemref>` elements inside `<spine>`. */
  spine?: string;
  /** Archive entries beyond the mimetype, container, and package documents. */
  entries?: Record<string, string | Uint8Array>;
};

const DEFAULT_SPEC = {
  metadata: "<dc:title>Test Book</dc:title>\n    <dc:creator>Test Author</dc:creator>",
  manifest: '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>',
  spineAttributes: "",
  spine: '<itemref idref="c1"/>',
  entries: { "OEBPS/chapter1.xhtml": CHAPTER } as Record<string, string | Uint8Array>,
} satisfies Required<EpubSpec>;

const buildPackageDocument = (spec: EpubSpec) => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${spec.metadata ?? DEFAULT_SPEC.metadata}
  </metadata>
  <manifest>
    ${spec.manifest ?? DEFAULT_SPEC.manifest}
  </manifest>
  <spine ${spec.spineAttributes ?? DEFAULT_SPEC.spineAttributes}>
    ${spec.spine ?? DEFAULT_SPEC.spine}
  </spine>
</package>`;

const buildEpubBytes = async (spec: EpubSpec = {}) => {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/content.opf", buildPackageDocument(spec));

  for (const [name, content] of Object.entries(spec.entries ?? DEFAULT_SPEC.entries)) {
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

  const bytes = await buildEpubBytes({
    entries: { ...DEFAULT_SPEC.entries, [placeholder]: "payload" },
  });
  const patched = Buffer.from(bytes.toString("latin1").replaceAll(placeholder, hostile), "latin1");
  expect(patched).toHaveLength(bytes.length);

  writeFileSync(filePath, patched);
};

let caseCounter = 0;

const makeCase = (name: string) => {
  // Every case gets its own directory, so a cached manifest from one test can
  // never satisfy another and reader directories stay independent.
  caseCounter += 1;
  const caseDirectory = path.join(testDirectory, `${caseCounter}-${name}`);
  rmSync(caseDirectory, { force: true, recursive: true });
  mkdirSync(caseDirectory, { recursive: true });

  return {
    caseDirectory,
    epubPath: path.join(caseDirectory, "original.epub"),
    readerDirectory: path.join(caseDirectory, "reader"),
  };
};

/** Write `spec` as an EPUB in a fresh case directory and return its paths. */
const writeEpub = async (name: string, spec: EpubSpec = {}) => {
  const paths = makeCase(name);
  writeFileSync(paths.epubPath, await buildEpubBytes(spec));
  return paths;
};

afterAll(() => {
  rmSync(testDirectory, { force: true, recursive: true });
});

describe("extractEpubMetadata", () => {
  test("reads the title and author out of the package document", async () => {
    const { epubPath } = await writeEpub("metadata-basic");

    const metadata = await extractEpubMetadata(epubPath);

    expect(metadata.title).toBe("Test Book");
    expect(metadata.author).toBe("Test Author");
    expect(metadata.coverBuffer).toBeNull();
    expect(metadata.coverExtension).toBeNull();
  });

  test("reports a missing title and author as null rather than guessing", async () => {
    const { epubPath } = await writeEpub("metadata-absent", {
      metadata: '<dc:identifier id="book-id">urn:uuid:1</dc:identifier>',
    });

    const metadata = await extractEpubMetadata(epubPath);

    expect(metadata.title).toBeNull();
    expect(metadata.author).toBeNull();
  });

  test("treats whitespace-only metadata as absent", async () => {
    const { epubPath } = await writeEpub("metadata-blank", {
      metadata: "<dc:title>   </dc:title>\n    <dc:creator>\n\n</dc:creator>",
    });

    const metadata = await extractEpubMetadata(epubPath);

    expect(metadata.title).toBeNull();
    expect(metadata.author).toBeNull();
  });

  test("reads text out of a metadata element that carries attributes", async () => {
    const { epubPath } = await writeEpub("metadata-attributes", {
      metadata:
        '<dc:title id="t1">Attributed Title</dc:title>\n' +
        '    <dc:creator opf:role="aut" xmlns:opf="http://www.idpf.org/2007/opf">Ann Author</dc:creator>',
    });

    const metadata = await extractEpubMetadata(epubPath);

    expect(metadata.title).toBe("Attributed Title");
    expect(metadata.author).toBe("Ann Author");
  });

  test("keeps the first creator when a book lists several", async () => {
    const { epubPath } = await writeEpub("metadata-creators", {
      metadata:
        "<dc:title>Two Authors</dc:title>\n" +
        "    <dc:creator>First Author</dc:creator>\n" +
        "    <dc:creator>Second Author</dc:creator>",
    });

    expect((await extractEpubMetadata(epubPath)).author).toBe("First Author");
  });

  test("finds an EPUB 3 cover declared through the cover-image property", async () => {
    const { epubPath } = await writeEpub("cover-property", {
      manifest:
        '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="art" href="images/art.png" media-type="image/png" properties="cover-image"/>',
      entries: { ...DEFAULT_SPEC.entries, "OEBPS/images/art.png": PNG_BYTES },
    });

    const metadata = await extractEpubMetadata(epubPath);

    expect(metadata.coverBuffer).toEqual(PNG_BYTES);
    expect(metadata.coverExtension).toBe(".png");
  });

  test("finds an EPUB 2 cover declared through a meta element", async () => {
    const { epubPath } = await writeEpub("cover-meta", {
      metadata: '<dc:title>Test Book</dc:title>\n    <meta name="cover" content="art"/>',
      manifest:
        '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="art" href="images/art.jpg" media-type="image/jpeg"/>',
      entries: { ...DEFAULT_SPEC.entries, "OEBPS/images/art.jpg": JPEG_BYTES },
    });

    const metadata = await extractEpubMetadata(epubPath);

    expect(metadata.coverBuffer).toEqual(JPEG_BYTES);
    expect(metadata.coverExtension).toBe(".jpg");
  });

  test("falls back to an image whose filename says cover", async () => {
    const { epubPath } = await writeEpub("cover-filename", {
      manifest:
        '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="plate" href="images/Cover-Plate.png" media-type="image/png"/>',
      entries: { ...DEFAULT_SPEC.entries, "OEBPS/images/Cover-Plate.png": PNG_BYTES },
    });

    expect((await extractEpubMetadata(epubPath)).coverBuffer).toEqual(PNG_BYTES);
  });

  test("prefers the cover-image property over both weaker signals", async () => {
    const { epubPath } = await writeEpub("cover-precedence", {
      metadata: '<dc:title>Test Book</dc:title>\n    <meta name="cover" content="pointed-at"/>',
      manifest:
        '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="named-cover" href="images/cover.png" media-type="image/png"/>\n' +
        '    <item id="pointed-at" href="images/meta.png" media-type="image/png"/>\n' +
        '    <item id="declared" href="images/real.png" media-type="image/png" properties="cover-image"/>',
      entries: {
        ...DEFAULT_SPEC.entries,
        "OEBPS/images/cover.png": Buffer.from("filename-match"),
        "OEBPS/images/meta.png": Buffer.from("meta-match"),
        "OEBPS/images/real.png": PNG_BYTES,
      },
    });

    expect((await extractEpubMetadata(epubPath)).coverBuffer).toEqual(PNG_BYTES);
  });

  test("prefers the meta element over a filename match", async () => {
    const { epubPath } = await writeEpub("cover-meta-over-filename", {
      metadata: '<dc:title>Test Book</dc:title>\n    <meta name="cover" content="pointed-at"/>',
      manifest:
        '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="named-cover" href="images/cover.png" media-type="image/png"/>\n' +
        '    <item id="pointed-at" href="images/meta.png" media-type="image/png"/>',
      entries: {
        ...DEFAULT_SPEC.entries,
        "OEBPS/images/cover.png": Buffer.from("filename-match"),
        "OEBPS/images/meta.png": PNG_BYTES,
      },
    });

    expect((await extractEpubMetadata(epubPath)).coverBuffer).toEqual(PNG_BYTES);
  });

  test("derives the cover extension from the media type when the href has none", async () => {
    const { epubPath } = await writeEpub("cover-extension-media-type", {
      manifest:
        '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="art" href="images/plate" media-type="image/webp" properties="cover-image"/>',
      entries: { ...DEFAULT_SPEC.entries, "OEBPS/images/plate": PNG_BYTES },
    });

    expect((await extractEpubMetadata(epubPath)).coverExtension).toBe(".webp");
  });

  test("lowercases an extension taken from the href", async () => {
    const { epubPath } = await writeEpub("cover-extension-case", {
      manifest:
        '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="art" href="images/PLATE.JPEG" media-type="image/jpeg" properties="cover-image"/>',
      entries: { ...DEFAULT_SPEC.entries, "OEBPS/images/PLATE.JPEG": JPEG_BYTES },
    });

    expect((await extractEpubMetadata(epubPath)).coverExtension).toBe(".jpeg");
  });

  test("returns a null extension for an extensionless cover of an unmapped type", async () => {
    const { epubPath } = await writeEpub("cover-extension-unknown", {
      manifest:
        '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="art" href="images/plate" media-type="image/avif" properties="cover-image"/>',
      entries: { ...DEFAULT_SPEC.entries, "OEBPS/images/plate": PNG_BYTES },
    });

    const metadata = await extractEpubMetadata(epubPath);

    expect(metadata.coverBuffer).toEqual(PNG_BYTES);
    expect(metadata.coverExtension).toBeNull();
  });

  test("survives a manifest that points at a cover the archive does not hold", async () => {
    const { epubPath } = await writeEpub("cover-missing-entry", {
      manifest:
        '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="art" href="images/gone.png" media-type="image/png" properties="cover-image"/>',
    });

    const metadata = await extractEpubMetadata(epubPath);

    expect(metadata.title).toBe("Test Book");
    expect(metadata.coverBuffer).toBeNull();
    expect(metadata.coverExtension).toBeNull();
  });

  test("resolves a cover href relative to the package document, not the archive root", async () => {
    const { epubPath } = await writeEpub("cover-relative", {
      manifest:
        '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="art" href="../shared/art.png" media-type="image/png" properties="cover-image"/>',
      entries: { ...DEFAULT_SPEC.entries, "shared/art.png": PNG_BYTES },
    });

    expect((await extractEpubMetadata(epubPath)).coverBuffer).toEqual(PNG_BYTES);
  });

  test("rejects a file that is not a zip archive at all", async () => {
    const { epubPath } = makeCase("not-a-zip");
    writeFileSync(epubPath, "this is not an epub");

    await expect(extractEpubMetadata(epubPath)).rejects.toThrow(
      "This file is not a valid EPUB archive.",
    );
  });

  test("names the missing piece when the container document is absent", async () => {
    const { epubPath } = makeCase("no-container");
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file("OEBPS/content.opf", buildPackageDocument({}));
    writeFileSync(epubPath, Buffer.from(await zip.generateAsync({ type: "uint8array" })));

    await expect(extractEpubMetadata(epubPath)).rejects.toThrow(
      "The EPUB is missing META-INF/container.xml.",
    );
  });

  test("names the missing piece when the container points nowhere", async () => {
    const { epubPath } = makeCase("no-rootfile");
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles/>
</container>`,
    );
    writeFileSync(epubPath, Buffer.from(await zip.generateAsync({ type: "uint8array" })));

    await expect(extractEpubMetadata(epubPath)).rejects.toThrow(
      "The EPUB package file could not be located.",
    );
  });

  test("names the missing piece when the package document itself is absent", async () => {
    const { epubPath } = makeCase("no-package");
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file("META-INF/container.xml", CONTAINER_XML);
    writeFileSync(epubPath, Buffer.from(await zip.generateAsync({ type: "uint8array" })));

    await expect(extractEpubMetadata(epubPath)).rejects.toThrow("The EPUB package file is missing.");
  });
});

describe("prepareEpubReader", () => {
  test("builds a manifest without unpacking the archive", async () => {
    const { epubPath, readerDirectory } = await writeEpub("plain");

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-plain");

    expect(manifest.title).toBe("Test Book");
    expect(manifest.author).toBe("Test Author");
    expect(manifest.sections).toHaveLength(1);
    expect(manifest.sections[0]?.href).toBe("OEBPS/chapter1.xhtml");
    expect(manifest.sections[0]?.textLength).toBe(5);

    // The whole point of serving from the zip: the reader directory holds the
    // manifest and nothing else, so a book costs its EPUB and a few hundred bytes.
    expect(readdirSync(readerDirectory)).toEqual(["manifest.json"]);
  });

  test("substitutes placeholders for a book with no title or author", async () => {
    const { epubPath, readerDirectory } = await writeEpub("untitled", {
      metadata: '<dc:identifier id="book-id">urn:uuid:1</dc:identifier>',
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-untitled");

    expect(manifest.title).toBe("Untitled Book");
    expect(manifest.author).toBe("Unknown Author");
  });

  test("reuses the manifest it already wrote instead of reopening the archive", async () => {
    const { epubPath, readerDirectory } = await writeEpub("cached");

    const first = await prepareEpubReader(epubPath, readerDirectory, "book-cached");
    // A different book id would produce different section URLs on a fresh build,
    // so identical output proves the second call never looked at the EPUB.
    const second = await prepareEpubReader(epubPath, readerDirectory, "other-book");

    expect(second).toEqual(first);
    expect(second.sections[0]?.url).toBe(first.sections[0]?.url);
  });

  test("refuses a book whose spine exposes nothing readable", async () => {
    const { epubPath, readerDirectory } = await writeEpub("empty-spine", { spine: "" });

    await expect(prepareEpubReader(epubPath, readerDirectory, "book-empty")).rejects.toThrow(
      "This EPUB does not expose readable spine sections.",
    );
  });

  test("builds one section per linear spine item, in spine order", async () => {
    const { epubPath, readerDirectory } = await writeEpub("spine-order", {
      manifest:
        '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="c3" href="chapter3.xhtml" media-type="application/xhtml+xml"/>',
      spine: '<itemref idref="c3"/><itemref idref="c1"/><itemref idref="c2"/>',
      entries: {
        "OEBPS/chapter1.xhtml": chapter("One"),
        "OEBPS/chapter2.xhtml": chapter("Two"),
        "OEBPS/chapter3.xhtml": chapter("Three"),
      },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-order");

    expect(manifest.sections.map((section) => section.label)).toEqual(["Three", "One", "Two"]);
    expect(manifest.sections.map((section) => section.id)).toEqual(["c3", "c1", "c2"]);
  });

  test("skips non-linear spine items, unresolvable idrefs, and repeats", async () => {
    const { epubPath, readerDirectory } = await writeEpub("spine-filtering", {
      manifest:
        '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="ad" href="advert.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="nohref" media-type="application/xhtml+xml"/>',
      spine:
        '<itemref idref="ad" linear="NO"/>' +
        '<itemref idref="missing-from-manifest"/>' +
        '<itemref idref="nohref"/>' +
        '<itemref idref="c1"/>' +
        '<itemref idref="c1"/>',
      entries: {
        "OEBPS/chapter1.xhtml": chapter("One"),
        "OEBPS/advert.xhtml": chapter("Advert"),
      },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-filtering");

    expect(manifest.sections.map((section) => section.href)).toEqual(["OEBPS/chapter1.xhtml"]);
  });

  test("percent-encodes each path segment of a section URL but not its href", async () => {
    const { epubPath, readerDirectory } = await writeEpub("encoded-href", {
      manifest: '<item id="c1" href="text/chapter one &amp; two.xhtml" media-type="application/xhtml+xml"/>',
      entries: { "OEBPS/text/chapter one & two.xhtml": chapter("One") },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-encoded");

    expect(manifest.sections[0]?.href).toBe("OEBPS/text/chapter one & two.xhtml");
    expect(manifest.sections[0]?.url).toBe(
      "/api/books/book-encoded/read/OEBPS/text/chapter%20one%20%26%20two.xhtml",
    );
  });
});

describe("prepareEpubReader section labels", () => {
  const NAV_MANIFEST =
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n' +
    '    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
    '    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>';
  const NAV_SPINE = '<itemref idref="c1"/><itemref idref="c2"/>';

  test("takes labels from an EPUB 3 navigation document", async () => {
    const { epubPath, readerDirectory } = await writeEpub("nav-labels", {
      manifest: NAV_MANIFEST,
      spine: NAV_SPINE,
      entries: {
        "OEBPS/nav.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="chapter1.xhtml">Opening Moves</a></li>
        <li><a href="chapter2.xhtml#part-two">Closing Moves</a></li>
      </ol>
    </nav>
  </body>
</html>`,
        "OEBPS/chapter1.xhtml": chapter("Ignored Document Title"),
        "OEBPS/chapter2.xhtml": chapter("Also Ignored"),
      },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-nav");

    expect(manifest.sections.map((section) => section.label)).toEqual([
      "Opening Moves",
      "Closing Moves",
    ]);
  });

  test("reads labels nested below the top level of the navigation list", async () => {
    const { epubPath, readerDirectory } = await writeEpub("nav-nested", {
      manifest: NAV_MANIFEST,
      spine: NAV_SPINE,
      entries: {
        "OEBPS/nav.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li>
          <a href="chapter1.xhtml">Part One</a>
          <ol>
            <li><a href="chapter2.xhtml">Part One, Section Two</a></li>
          </ol>
        </li>
      </ol>
    </nav>
  </body>
</html>`,
        "OEBPS/chapter1.xhtml": untitledChapter(),
        "OEBPS/chapter2.xhtml": untitledChapter(),
      },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-nav-nested");

    expect(manifest.sections.map((section) => section.label)).toEqual([
      "Part One",
      "Part One, Section Two",
    ]);
  });

  test("picks the toc nav when the document declares several", async () => {
    const { epubPath, readerDirectory } = await writeEpub("nav-multiple", {
      manifest: NAV_MANIFEST,
      spine: NAV_SPINE,
      entries: {
        "OEBPS/nav.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="landmarks">
      <ol><li><a href="chapter1.xhtml">Start Reading</a></li></ol>
    </nav>
    <nav epub:type="toc">
      <ol>
        <li><a href="chapter1.xhtml">Real First Label</a></li>
        <li><a href="chapter2.xhtml">Real Second Label</a></li>
      </ol>
    </nav>
  </body>
</html>`,
        "OEBPS/chapter1.xhtml": untitledChapter(),
        "OEBPS/chapter2.xhtml": untitledChapter(),
      },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-nav-multiple");

    expect(manifest.sections.map((section) => section.label)).toEqual([
      "Real First Label",
      "Real Second Label",
    ]);
  });

  test("resolves navigation hrefs relative to the navigation document", async () => {
    const { epubPath, readerDirectory } = await writeEpub("nav-relative", {
      manifest:
        '<item id="nav" href="nav/toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n' +
        '    <item id="c1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>',
      spine: '<itemref idref="c1"/>',
      entries: {
        "OEBPS/nav/toc.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol><li><a href="../text/chapter1.xhtml">Resolved Label</a></li></ol>
    </nav>
  </body>
</html>`,
        "OEBPS/text/chapter1.xhtml": untitledChapter(),
      },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-nav-relative");

    expect(manifest.sections[0]?.label).toBe("Resolved Label");
  });

  test("falls back to an EPUB 2 NCX when there is no navigation document", async () => {
    const { epubPath, readerDirectory } = await writeEpub("ncx-labels", {
      manifest:
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n' +
        '    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>',
      spineAttributes: 'toc="ncx"',
      spine: NAV_SPINE,
      entries: {
        "OEBPS/toc.ncx": `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="np1">
      <navLabel><text>NCX First</text></navLabel>
      <content src="chapter1.xhtml"/>
      <navPoint id="np1-1">
        <navLabel><text>NCX Nested</text></navLabel>
        <content src="chapter2.xhtml#anchor"/>
      </navPoint>
    </navPoint>
  </navMap>
</ncx>`,
        "OEBPS/chapter1.xhtml": chapter("Ignored"),
        "OEBPS/chapter2.xhtml": chapter("Also Ignored"),
      },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-ncx");

    expect(manifest.sections.map((section) => section.label)).toEqual([
      "NCX First",
      "NCX Nested",
    ]);
  });

  test("finds the NCX by media type when the spine does not name it", async () => {
    const { epubPath, readerDirectory } = await writeEpub("ncx-by-media-type", {
      manifest:
        '<item id="whatever" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n' +
        '    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>',
      spine: '<itemref idref="c1"/>',
      entries: {
        "OEBPS/toc.ncx": `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="np1">
      <navLabel><text>Found By Media Type</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`,
        "OEBPS/chapter1.xhtml": untitledChapter(),
      },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-ncx-media");

    expect(manifest.sections[0]?.label).toBe("Found By Media Type");
  });

  test("prefers the navigation document over the NCX when a book ships both", async () => {
    const { epubPath, readerDirectory } = await writeEpub("nav-over-ncx", {
      manifest:
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n' +
        '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n' +
        '    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>',
      spineAttributes: 'toc="ncx"',
      spine: '<itemref idref="c1"/>',
      entries: {
        "OEBPS/nav.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol><li><a href="chapter1.xhtml">From Nav</a></li></ol>
    </nav>
  </body>
</html>`,
        "OEBPS/toc.ncx": `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="np1">
      <navLabel><text>From NCX</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`,
        "OEBPS/chapter1.xhtml": untitledChapter(),
      },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-nav-over-ncx");

    expect(manifest.sections[0]?.label).toBe("From Nav");
  });

  test("falls through to the NCX when the navigation document lists no usable links", async () => {
    const { epubPath, readerDirectory } = await writeEpub("nav-empty-then-ncx", {
      manifest:
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n' +
        '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n' +
        '    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>',
      spine: '<itemref idref="c1"/>',
      entries: {
        "OEBPS/nav.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol></ol></nav></body>
</html>`,
        "OEBPS/toc.ncx": `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="np1">
      <navLabel><text>NCX Rescue</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`,
        "OEBPS/chapter1.xhtml": untitledChapter(),
      },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-nav-empty");

    expect(manifest.sections[0]?.label).toBe("NCX Rescue");
  });

  test("labels a section the table of contents omits from the document itself", async () => {
    const { epubPath, readerDirectory } = await writeEpub("toc-partial", {
      manifest: NAV_MANIFEST,
      spine: NAV_SPINE,
      entries: {
        "OEBPS/nav.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol><li><a href="chapter1.xhtml">Listed Chapter</a></li></ol>
    </nav>
  </body>
</html>`,
        "OEBPS/chapter1.xhtml": chapter("Ignored"),
        "OEBPS/chapter2.xhtml": chapter("Unlisted Chapter"),
      },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-toc-partial");

    expect(manifest.sections.map((section) => section.label)).toEqual([
      "Listed Chapter",
      "Unlisted Chapter",
    ]);
  });

  test("infers a label from the document heading when there is no title element", async () => {
    const { epubPath, readerDirectory } = await writeEpub("heading-labels", {
      manifest:
        '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="c3" href="chapter3.xhtml" media-type="application/xhtml+xml"/>',
      spine: '<itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/>',
      entries: {
        "OEBPS/chapter1.xhtml": untitledChapter("<h1>Heading One</h1><p>Body</p>"),
        "OEBPS/chapter2.xhtml": untitledChapter("<h2>Heading Two</h2><p>Body</p>"),
        "OEBPS/chapter3.xhtml": untitledChapter("<section><h1>Sectioned Heading</h1></section>"),
      },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-headings");

    expect(manifest.sections.map((section) => section.label)).toEqual([
      "Heading One",
      "Heading Two",
      "Sectioned Heading",
    ]);
  });

  test("prefers the document title over a heading", async () => {
    const { epubPath, readerDirectory } = await writeEpub("title-over-heading", {
      entries: { "OEBPS/chapter1.xhtml": chapter("From Title", "<h1>From Heading</h1>") },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-title-first");

    expect(manifest.sections[0]?.label).toBe("From Title");
  });

  test("prettifies the filename when the document offers no title or heading", async () => {
    const { epubPath, readerDirectory } = await writeEpub("filename-label", {
      manifest: '<item id="c1" href="the_long-chapter.xhtml" media-type="application/xhtml+xml"/>',
      entries: { "OEBPS/the_long-chapter.xhtml": untitledChapter("<p>Body</p>") },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-filename");

    expect(manifest.sections[0]?.label).toBe("The long chapter");
  });

  test("prettifies the filename for a spine item the archive does not hold", async () => {
    const { epubPath, readerDirectory } = await writeEpub("missing-entry-label", {
      manifest: '<item id="c1" href="ghost-chapter.xhtml" media-type="application/xhtml+xml"/>',
      entries: { "OEBPS/chapter1.xhtml": CHAPTER },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-missing-entry");

    expect(manifest.sections[0]?.label).toBe("Ghost chapter");
  });

  test("numbers a section whose filename prettifies to nothing", async () => {
    const { epubPath, readerDirectory } = await writeEpub("numbered-label", {
      manifest:
        '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
        '    <item id="c2" href="_.xhtml" media-type="application/xhtml+xml"/>',
      spine: '<itemref idref="c1"/><itemref idref="c2"/>',
      entries: {
        "OEBPS/chapter1.xhtml": chapter("One"),
        "OEBPS/_.xhtml": untitledChapter("<p>Body</p>"),
      },
    });

    const manifest = await prepareEpubReader(epubPath, readerDirectory, "book-numbered");

    // The number is the spine index, so the second item reads "Section 2".
    expect(manifest.sections[1]?.label).toBe("Section 2");
  });
});

describe("readEpubReaderAsset", () => {
  // This is the guard that actually faces untrusted input: the asset path comes
  // from the request URL, which nothing has sanitized on the way in.
  test("returns the entry bytes for an ordinary path", async () => {
    const { epubPath } = await writeEpub("asset-ordinary");

    const bytes = await readEpubReaderAsset(epubPath, "OEBPS/chapter1.xhtml");

    expect(bytes?.toString("utf8")).toBe(CHAPTER);
  });

  test("treats an absolute-looking path as archive-relative", async () => {
    const { epubPath } = await writeEpub("asset-absolute");

    const bytes = await readEpubReaderAsset(epubPath, "/OEBPS/chapter1.xhtml");

    expect(bytes?.toString("utf8")).toBe(CHAPTER);
  });

  test("normalizes interior traversal that stays inside the archive", async () => {
    const { epubPath } = await writeEpub("asset-interior");

    const bytes = await readEpubReaderAsset(epubPath, "OEBPS/images/../chapter1.xhtml");

    expect(bytes?.toString("utf8")).toBe(CHAPTER);
  });

  test("returns null for an entry the archive does not hold", async () => {
    const { epubPath } = await writeEpub("asset-missing");

    expect(await readEpubReaderAsset(epubPath, "OEBPS/missing.xhtml")).toBeNull();
  });

  test("returns null for a directory prefix rather than a zero-byte body", async () => {
    const { epubPath } = await writeEpub("asset-directory");

    expect(await readEpubReaderAsset(epubPath, "OEBPS")).toBeNull();
  });

  test("returns binary entries byte for byte", async () => {
    const { epubPath } = await writeEpub("asset-binary", {
      entries: { ...DEFAULT_SPEC.entries, "OEBPS/images/art.png": PNG_BYTES },
    });

    const bytes = await readEpubReaderAsset(epubPath, "OEBPS/images/art.png");

    expect(bytes).toEqual(PNG_BYTES);
  });

  test("rejects paths that climb out of the archive root", async () => {
    const { epubPath } = await writeEpub("asset-traversal-input");

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
    const { epubPath } = makeCase("asset-traversal-archive");
    await writeEpubWithTraversingEntry(epubPath);

    await expect(readEpubReaderAsset(epubPath, "evil.txt")).rejects.toThrow(
      "This file is not a valid EPUB archive.",
    );
  });

  test("rejects a file that is not a zip archive", async () => {
    const { epubPath } = makeCase("asset-not-a-zip");
    writeFileSync(epubPath, "this is not an epub");

    await expect(readEpubReaderAsset(epubPath, "OEBPS/chapter1.xhtml")).rejects.toThrow(
      "This file is not a valid EPUB archive.",
    );
  });
});

/**
 * yauzl refuses to enumerate an archive whose central directory carries a
 * ".." segment, so the file is rejected whole rather than per entry. That is
 * uniform: importing the same file parses its metadata through the same
 * reader and fails the same way, so no such book can reach the library.
 */
describe("archives with a traversing entry name", () => {
  test("are rejected by every entry point, and write nothing", async () => {
    const { caseDirectory, epubPath, readerDirectory } = makeCase("traversal");
    await writeEpubWithTraversingEntry(epubPath);

    await expect(extractEpubMetadata(epubPath)).rejects.toThrow(
      "This file is not a valid EPUB archive.",
    );
    await expect(prepareEpubReader(epubPath, readerDirectory, "book-traversal")).rejects.toThrow(
      "This file is not a valid EPUB archive.",
    );

    // Nothing may be written outside the reader directory, by any route.
    expect(existsSync(path.join(caseDirectory, "evil.txt"))).toBe(false);
    expect(existsSync(path.join(testDirectory, "evil.txt"))).toBe(false);
  });
});
