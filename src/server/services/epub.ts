import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { XMLParser } from "fast-xml-parser";
import { openPromise, type Entry, type ZipFile } from "yauzl";

import { normalizeReaderText } from "../../shared/reader-text";
import {
  READER_TEXT_VERSION,
  type BookReaderSection,
} from "../../shared/types";
import { AppError } from "../errors";

type ManifestItem = {
  "@_id"?: string;
  "@_href"?: string;
  "@_media-type"?: string;
  "@_properties"?: string;
};

type MetaItem = {
  "@_name"?: string;
  "@_content"?: string;
};

type SpineItemRef = {
  "@_idref"?: string;
  "@_linear"?: string;
};

type ExtractedEpub = {
  title: string | null;
  author: string | null;
  coverBuffer: Uint8Array | null;
  coverExtension: string | null;
};

type ReaderManifest = {
  title: string;
  author: string;
  sections: BookReaderSection[];
};

type ReaderSpineSection = Omit<BookReaderSection, "url">;

export type EpubReaderTextSection = ReaderSpineSection & {
  spineIndex: number;
  textVersion: typeof READER_TEXT_VERSION;
  text: string;
};

type OrderedXmlNode = Record<string, unknown>;

type RenderedText = {
  rendered: boolean;
  text: string;
};

type ParsedEpub = {
  zip: ZipFile;
  entries: Map<string, Entry>;
  opfPath: string;
  title: string | null;
  author: string | null;
  manifestItems: ManifestItem[];
  manifestById: Map<string, ManifestItem>;
  metaItems: MetaItem[];
  spineItems: SpineItemRef[];
  navPath: string | null;
  ncxPath: string | null;
};

const MANIFEST_FILENAME = "manifest.json";
const MAX_EPUB_ENTRIES = 10_000;
const MAX_EPUB_XML_BYTES = 5 * 1024 * 1024;
const MAX_EPUB_COVER_BYTES = 50 * 1024 * 1024;
const MAX_EPUB_READER_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_EPUB_READER_TEXT_BYTES = 50 * 1024 * 1024;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
});

const orderedTextParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  preserveOrder: true,
  processEntities: true,
  parseTagValue: false,
  trimValues: false,
});

const DROPPED_READER_TAGS: Record<string, true> = {
  head: true,
  link: true,
  meta: true,
  script: true,
  style: true,
  title: true,
};
const TEXTLESS_READER_TAGS: Record<string, true> = {
  br: true,
  hr: true,
  img: true,
  svg: true,
};
const INLINE_READER_TAGS: Record<string, true> = {
  a: true,
  abbr: true,
  b: true,
  caption: true,
  cite: true,
  del: true,
  em: true,
  figcaption: true,
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
  i: true,
  ins: true,
  mark: true,
  s: true,
  small: true,
  span: true,
  strong: true,
  sub: true,
  sup: true,
  time: true,
  u: true,
};
const GROUP_READER_TAGS: Record<string, true> = {
  article: true,
  aside: true,
  div: true,
  footer: true,
  header: true,
  main: true,
  nav: true,
  section: true,
};
const BLOCK_READER_TAGS: Record<string, true> = {
  blockquote: true,
  figure: true,
  ol: true,
  table: true,
  tbody: true,
  tfoot: true,
  thead: true,
  tr: true,
  ul: true,
};
const BLOCK_WITH_INLINE_FALLBACK_TAGS: Record<string, true> = {
  li: true,
  td: true,
  th: true,
};

const renderedChildrenText = (
  nodes: OrderedXmlNode[],
  mode: "block" | "inline" | "pre",
): { renderedCount: number; text: string } => {
  const rendered = nodes.map((node) => renderedNodeText(node, mode)).filter((node) => node.rendered);
  return {
    renderedCount: rendered.length,
    text: rendered.map((node) => node.text).join(""),
  };
};

const renderedTextNode = (
  value: unknown,
  mode: "block" | "inline" | "pre",
): RenderedText => {
  if (typeof value !== "string" || value.length === 0) {
    return { rendered: false, text: "" };
  }
  if (mode === "pre") {
    return { rendered: true, text: value };
  }

  const text = normalizeReaderText(value);
  if (!text.trim()) {
    return mode === "block" || !text.includes(" ")
      ? { rendered: false, text: "" }
      : { rendered: true, text: " " };
  }
  return { rendered: true, text };
};

const orderedElement = (node: OrderedXmlNode) =>
  Object.entries(node).find(([name]) => name !== ":@");

const renderedNodeText = (
  node: OrderedXmlNode,
  mode: "block" | "inline" | "pre",
): RenderedText => {
  const element = orderedElement(node);
  if (!element) return { rendered: false, text: "" };

  const [rawTag, rawChildren] = element;
  if (rawTag === "#text") return renderedTextNode(rawChildren, mode);
  if (rawTag.startsWith("#") || rawTag.startsWith("?") || !Array.isArray(rawChildren)) {
    return { rendered: false, text: "" };
  }

  const tag = rawTag.toLowerCase();
  if (DROPPED_READER_TAGS[tag]) return { rendered: false, text: "" };
  if (TEXTLESS_READER_TAGS[tag]) {
    if (tag === "img") {
      const attributes = node[":@"] as Record<string, unknown> | undefined;
      const src = attributes?.["@_src"];
      return { rendered: typeof src === "string" && src.length > 0, text: "" };
    }
    return { rendered: true, text: "" };
  }

  const children = rawChildren as OrderedXmlNode[];
  const childrenMode = tag === "pre" || mode === "pre" ? "pre" : "inline";
  const inline = renderedChildrenText(children, childrenMode);
  const block = renderedChildrenText(children, "block");

  if (tag === "body") return { rendered: true, text: block.text };
  if (tag === "pre") return { rendered: true, text: inline.text };
  if (tag === "code") return { rendered: true, text: inline.text };
  if (tag === "p") {
    return inline.renderedCount === 0
      ? { rendered: false, text: "" }
      : { rendered: true, text: inline.text };
  }
  if (INLINE_READER_TAGS[tag]) return { rendered: true, text: inline.text };
  if (BLOCK_WITH_INLINE_FALLBACK_TAGS[tag]) {
    return { rendered: true, text: block.renderedCount > 0 ? block.text : inline.text };
  }
  if (GROUP_READER_TAGS[tag]) {
    return { rendered: true, text: mode === "inline" ? inline.text : block.text };
  }
  if (BLOCK_READER_TAGS[tag]) return { rendered: true, text: block.text };

  return {
    rendered: true,
    text: mode === "inline" || block.renderedCount === 0 ? inline.text : block.text,
  };
};

const findOrderedElementChildren = (
  nodes: OrderedXmlNode[],
  expectedTag: string,
): OrderedXmlNode[] | null => {
  for (const node of nodes) {
    const element = orderedElement(node);
    if (!element) continue;
    const [rawTag, rawChildren] = element;
    if (!Array.isArray(rawChildren)) continue;
    if (rawTag.toLowerCase() === expectedTag) return rawChildren as OrderedXmlNode[];
    const nested = findOrderedElementChildren(rawChildren as OrderedXmlNode[], expectedTag);
    if (nested) return nested;
  }
  return null;
};

const extractCanonicalReaderText = (markup: string) => {
  const document = orderedTextParser.parse(markup) as OrderedXmlNode[];
  const content =
    findOrderedElementChildren(document, "body") ??
    findOrderedElementChildren(document, "html") ??
    document;
  return normalizeReaderText(renderedChildrenText(content, "block").text);
};

const asArray = <T>(value: T | T[] | undefined): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const asText = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "object" && value !== null) {
    const text = Reflect.get(value, "#text");
    if (typeof text === "string") {
      const trimmed = text.trim();
      return trimmed || null;
    }
  }
  return null;
};

const getTextContent = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => getTextContent(item)).filter(Boolean).join(" ").trim();
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const text = entries
      .filter(([key]) => !key.startsWith("@_"))
      .map(([, item]) => getTextContent(item))
      .filter(Boolean)
      .join(" ")
      .trim();

    if (text) return text;
  }
  return "";
};

const extensionFromManifest = (item: ManifestItem) => {
  const fromHref = item["@_href"] ? path.extname(item["@_href"]).toLowerCase() : "";
  if (fromHref) return fromHref;

  switch (item["@_media-type"]) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return null;
  }
};
const selectCoverItem = (manifestItems: ManifestItem[], metaItems: MetaItem[]) => {
  const coverId = metaItems.find((item) => item["@_name"] === "cover")?.["@_content"] ?? null;

  return (
    manifestItems.find((item) => item["@_properties"]?.includes("cover-image")) ??
    manifestItems.find((item) => item["@_id"] === coverId) ??
    manifestItems.find(
      (item) =>
        item["@_media-type"]?.startsWith("image/") &&
        item["@_href"]?.toLowerCase().includes("cover"),
    ) ??
    null
  );
};


const resolveRelativeZipPath = (basePath: string, href: string) =>
  path.posix.normalize(path.posix.join(path.posix.dirname(basePath), href));

const normalizeZipPath = (value: string) => path.posix.normalize(value).replace(/^\/+/, "");

const encodeAssetPath = (value: string) =>
  value
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const prettifySectionLabel = (value: string) =>
  path.posix
    .basename(value, path.posix.extname(value))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (character) => character.toUpperCase());

const parsePackage = (
  opfXml: string,
  opfPath: string,
): Omit<ParsedEpub, "zip" | "entries" | "opfPath"> => {
  const opf = parser.parse(opfXml);
  const metadata = opf.package?.metadata ?? {};
  const manifestItems = asArray<ManifestItem>(opf.package?.manifest?.item);
  const metaItems = asArray<MetaItem>(metadata.meta);
  const spineItems = asArray<SpineItemRef>(opf.package?.spine?.itemref);
  const manifestById = new Map(
    manifestItems
      .filter((item): item is ManifestItem & { "@_id": string } => typeof item["@_id"] === "string")
      .map((item) => [item["@_id"], item]),
  );
  const navItem =
    manifestItems.find((item) => item["@_properties"]?.split(/\s+/).includes("nav")) ?? null;
  const ncxId = asText(opf.package?.spine?.["@_toc"]);
  const ncxItem =
    (ncxId ? manifestById.get(ncxId) : null) ??
    manifestItems.find((item) => item["@_media-type"] === "application/x-dtbncx+xml") ??
    null;

  return {
    title: asText(metadata.title),
    author: asText(asArray(metadata.creator)[0]),
    manifestItems,
    manifestById,
    metaItems,
    spineItems,
    navPath: navItem?.["@_href"] ? resolveRelativeZipPath(opfPath, navItem["@_href"]) : null,
    ncxPath: ncxItem?.["@_href"] ? resolveRelativeZipPath(opfPath, ncxItem["@_href"]) : null,
  };
};

/**
 * Open an EPUB and read only its container and package documents.
 *
 * The archive stays open because every later read seeks back into it, so the
 * caller owns `zip.close()`. A failure in here closes it before throwing.
 */
const openEpub = async (filePath: string): Promise<ParsedEpub> => {
  let zip: ZipFile;

  try {
    zip = await openPromise(filePath, {
      autoClose: false,
      lazyEntries: true,
      validateEntrySizes: true,
    });
  } catch {
    throw new AppError(400, "This file is not a valid EPUB archive.");
  }

  try {
    const entries = await indexZipEntries(zip);
    const containerEntry = entries.get("META-INF/container.xml");
    if (!containerEntry) {
      throw new AppError(400, "The EPUB is missing META-INF/container.xml.");
    }

    const containerXml = (
      await readZipEntry(zip, containerEntry, MAX_EPUB_XML_BYTES, "container document")
    ).toString("utf8");
    const container = parser.parse(containerXml);
    const rootFile = asArray(container.container?.rootfiles?.rootfile)[0];
    const opfPath = rootFile?.["@_full-path"];

    if (!opfPath || typeof opfPath !== "string") {
      throw new AppError(400, "The EPUB package file could not be located.");
    }

    const opfEntry = entries.get(normalizeZipPath(opfPath));
    if (!opfEntry) {
      throw new AppError(400, "The EPUB package file is missing.");
    }

    const opfXml = (
      await readZipEntry(zip, opfEntry, MAX_EPUB_XML_BYTES, "package document")
    ).toString("utf8");

    return { zip, entries, opfPath, ...parsePackage(opfXml, opfPath) };
  } catch (error) {
    zip.close();
    if (error instanceof AppError) throw error;
    throw new AppError(400, "This file is not a valid EPUB archive.");
  }
};

/**
 * Text for one entry, or null when it is missing or over the size cap.
 *
 * Only documents whose absence is already tolerated are read this way — a
 * navigation document, a section consulted for its title — so an oversized one
 * degrades to the same fallback rather than failing the whole book.
 */
const readEntryText = async (parsed: ParsedEpub, zipPath: string) => {
  const entry = parsed.entries.get(normalizeZipPath(zipPath));
  if (!entry || entry.uncompressedSize > MAX_EPUB_XML_BYTES) return null;

  try {
    return (
      await readZipEntry(parsed.zip, entry, MAX_EPUB_XML_BYTES, "document")
    ).toString("utf8");
  } catch {
    return null;
  }
};

const extractTocLabelsFromNav = async (parsed: ParsedEpub) => {
  if (!parsed.navPath) return new Map<string, string>();

  const navXml = await readEntryText(parsed, parsed.navPath);
  if (!navXml) return new Map<string, string>();

  const navDocument = parser.parse(navXml);
  const navNodes = asArray(navDocument.html?.body?.nav);
  const tocNav =
    navNodes.find((node) => node?.["@_type"]?.split(/\s+/).includes("toc")) ?? navNodes[0];

  const labels = new Map<string, string>();

  const visitNode = (node: unknown) => {
    if (!node || typeof node !== "object") return;

    const record = node as Record<string, unknown>;
    for (const anchor of asArray(record.a)) {
      if (!anchor || typeof anchor !== "object") continue;
      const href = asText(Reflect.get(anchor, "@_href"));
      const label = getTextContent(anchor);
      if (!href || !label) continue;

      labels.set(resolveRelativeZipPath(parsed.navPath as string, href.split("#")[0] ?? href), label);
    }

    for (const listItem of asArray(record.li)) {
      visitNode(listItem);
    }

    for (const child of asArray(record.ol)) {
      visitNode(child);
    }
  };

  visitNode(tocNav);
  return labels;
};

const extractTocLabelsFromNcx = async (parsed: ParsedEpub) => {
  if (!parsed.ncxPath) return new Map<string, string>();

  const ncxXml = await readEntryText(parsed, parsed.ncxPath);
  if (!ncxXml) return new Map<string, string>();

  const ncx = parser.parse(ncxXml);
  const labels = new Map<string, string>();

  const visitNode = (node: unknown) => {
    if (!node || typeof node !== "object") return;

    const record = node as Record<string, unknown>;
    const href = asText(record.content && Reflect.get(record.content, "@_src"));
    const navLabel =
      record.navLabel && typeof record.navLabel === "object"
        ? Reflect.get(record.navLabel, "text")
        : null;
    const label = asText(navLabel);

    if (href && label) {
      labels.set(resolveRelativeZipPath(parsed.ncxPath as string, href.split("#")[0] ?? href), label);
    }

    for (const child of asArray(record.navPoint)) {
      visitNode(child);
    }
  };

  for (const navPoint of asArray(ncx.ncx?.navMap?.navPoint)) {
    visitNode(navPoint);
  }

  return labels;
};

const inferSectionLabel = async (parsed: ParsedEpub, sectionPath: string, fallbackIndex: number) => {
  const sectionXml = await readEntryText(parsed, sectionPath);
  if (!sectionXml) {
    return prettifySectionLabel(sectionPath) || `Section ${fallbackIndex + 1}`;
  }

  try {
    const document = parser.parse(sectionXml);
    const title =
      asText(document.html?.head?.title) ??
      asText(document.html?.body?.h1) ??
      asText(document.html?.body?.h2) ??
      asText(asArray(document.html?.body?.section)[0]?.h1) ??
      asText(asArray(document.html?.body?.section)[0]?.h2);

    return title ?? (prettifySectionLabel(sectionPath) || `Section ${fallbackIndex + 1}`);
  } catch {
    return prettifySectionLabel(sectionPath) || `Section ${fallbackIndex + 1}`;
  }
};

const buildReaderSpineSections = async (parsed: ParsedEpub): Promise<ReaderSpineSection[]> => {
  const sections: ReaderSpineSection[] = [];
  const seen = new Set<string>();
  const navLabels = await extractTocLabelsFromNav(parsed);
  const tocLabels = navLabels.size > 0 ? navLabels : await extractTocLabelsFromNcx(parsed);

  for (const [index, spineItem] of parsed.spineItems.entries()) {
    const idref = spineItem["@_idref"];
    const manifestItem = idref ? parsed.manifestById.get(idref) : null;
    const href = manifestItem?.["@_href"];

    if (!href) continue;
    if (spineItem["@_linear"]?.toLowerCase() === "no") continue;

    const zipPath = normalizeZipPath(resolveRelativeZipPath(parsed.opfPath, href));
    if (seen.has(zipPath)) continue;
    seen.add(zipPath);

    const label =
      tocLabels.get(zipPath) ??
      (await inferSectionLabel(parsed, zipPath, index)) ??
      `Section ${index + 1}`;

    sections.push({
      id: idref ?? `section-${index + 1}`,
      href: zipPath,
      label,
    });
  }

  return sections;
};

const buildReaderSections = async (
  parsed: ParsedEpub,
  bookId: string,
): Promise<BookReaderSection[]> =>
  (await buildReaderSpineSections(parsed)).map((section) => ({
    ...section,
    url: `/api/books/${bookId}/read/${encodeAssetPath(section.href)}`,
  }));

/**
 * A normalized path that stays inside the reader directory, or null if it escapes.
 *
 * Normalizing first means the only forms left to reject are a leading "../", or
 * a path that collapses to "." or ".." outright. Those last two matter: ".." has
 * no trailing slash, so a `startsWith("../")` check alone let it through and it
 * resolved to the directory above the extracted content.
 */
const safeRelativePath = (value: string) => {
  const normalized = normalizeZipPath(value);
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return null;
  }
  return normalized;
};

const ensureSafeRelativePath = (value: string) => {
  const normalized = safeRelativePath(value);
  if (!normalized) {
    throw new AppError(400, "Invalid reader asset path.");
  }
  return normalized;
};

const manifestPath = (readerDir: string) => path.join(readerDir, MANIFEST_FILENAME);

const readCachedReaderManifest = async (readerDir: string): Promise<ReaderManifest | null> => {
  try {
    const cached = await readFile(manifestPath(readerDir), "utf8");
    const parsed = JSON.parse(cached) as Partial<ReaderManifest>;

    if (
      typeof parsed.title === "string" &&
      typeof parsed.author === "string" &&
      Array.isArray(parsed.sections) &&
      parsed.sections.every(
        (section) =>
          typeof section?.id === "string" &&
          typeof section?.href === "string" &&
          typeof section?.label === "string" &&
          typeof section?.url === "string",
      )
    ) {
      return parsed as ReaderManifest;
    }
  } catch {
    return null;
  }

  return null;
};

const indexZipEntries = async (zip: ZipFile) => {
  const entries = new Map<string, Entry>();
  let entryCount = 0;

  for await (const entry of zip.eachEntry()) {
    entryCount += 1;
    if (entryCount > MAX_EPUB_ENTRIES) {
      throw new AppError(400, `The EPUB contains more than ${MAX_EPUB_ENTRIES} entries.`);
    }

    // Directory entries carry a trailing slash and no content. Leaving them out
    // keeps a request for "OEBPS/" from resolving to a zero-byte 200.
    if (entry.fileName.endsWith("/")) continue;

    const entryPath = normalizeZipPath(entry.fileName);
    if (!entries.has(entryPath)) {
      entries.set(entryPath, entry);
    }
  }

  return entries;
};

const readZipEntry = async (
  zip: ZipFile,
  entry: Entry,
  maxBytes: number,
  description: string,
) => {
  if (entry.uncompressedSize > maxBytes) {
    throw new AppError(400, `The EPUB ${description} is too large.`);
  }

  const stream = await zip.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let byteLength = 0;

  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.length;
    if (byteLength > maxBytes) {
      stream.destroy();
      throw new AppError(400, `The EPUB ${description} is too large.`);
    }
    chunks.push(bytes);
  }

  return Buffer.concat(chunks, byteLength);
};

export const extractEpubMetadata = async (filePath: string): Promise<ExtractedEpub> => {
  const parsed = await openEpub(filePath);

  try {
    const coverItem = selectCoverItem(parsed.manifestItems, parsed.metaItems);
    const coverHref = coverItem?.["@_href"];
    if (!coverItem || !coverHref) {
      return {
        title: parsed.title,
        author: parsed.author,
        coverBuffer: null,
        coverExtension: null,
      };
    }

    const coverEntry = parsed.entries.get(
      normalizeZipPath(resolveRelativeZipPath(parsed.opfPath, coverHref)),
    );
    if (!coverEntry) {
      return {
        title: parsed.title,
        author: parsed.author,
        coverBuffer: null,
        coverExtension: null,
      };
    }

    return {
      title: parsed.title,
      author: parsed.author,
      coverBuffer: await readZipEntry(
        parsed.zip,
        coverEntry,
        MAX_EPUB_COVER_BYTES,
        "cover image",
      ),
      coverExtension: extensionFromManifest(coverItem),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "This file is not a valid EPUB archive.");
  } finally {
    parsed.zip.close();
  }
};

/**
 * Build (or reuse) the reader manifest for a book.
 *
 * Only the manifest is written. Unpacking the archive used to double a book's
 * uncompressed footprint on disk for assets the reader mostly never asks for;
 * `sweepExtractedReaderContent` clears what older builds left behind.
 */
export const prepareEpubReader = async (
  filePath: string,
  readerDir: string,
  bookId: string,
): Promise<ReaderManifest> => {
  const cached = await readCachedReaderManifest(readerDir);
  if (cached) return cached;

  const parsed = await openEpub(filePath);
  let sections: BookReaderSection[];

  try {
    sections = await buildReaderSections(parsed, bookId);
  } finally {
    parsed.zip.close();
  }

  if (sections.length === 0) {
    throw new AppError(400, "This EPUB does not expose readable spine sections.");
  }

  const manifest: ReaderManifest = {
    title: parsed.title ?? "Untitled Book",
    author: parsed.author ?? "Unknown Author",
    sections,
  };

  await rm(readerDir, { recursive: true, force: true });
  await mkdir(readerDir, { recursive: true });
  await writeFile(manifestPath(readerDir), JSON.stringify(manifest, null, 2));

  return manifest;
};

/**
 * Canonical visible text for every linear spine section, in reading order.
 *
 * This uses the renderer's element and whitespace rules so search offsets map
 * directly to the DOM ranges resolved by the web reader.
 */
export const extractEpubReaderTextSections = async (
  filePath: string,
): Promise<EpubReaderTextSection[]> => {
  const parsed = await openEpub(filePath);

  try {
    const sections = await buildReaderSpineSections(parsed);
    if (sections.length === 0) {
      throw new AppError(400, "This EPUB does not expose readable spine sections.");
    }
    const textSections: EpubReaderTextSection[] = [];

    for (const [spineIndex, section] of sections.entries()) {
      const entry = parsed.entries.get(section.href);
      if (!entry) {
        throw new AppError(400, `The EPUB reader section "${section.href}" is missing.`);
      }
      const markup = (
        await readZipEntry(
          parsed.zip,
          entry,
          MAX_EPUB_READER_TEXT_BYTES,
          `reader section "${section.href}"`,
        )
      ).toString("utf8");

      textSections.push({
        ...section,
        spineIndex,
        textVersion: READER_TEXT_VERSION,
        text: extractCanonicalReaderText(markup),
      });
    }

    return textSections;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "This EPUB contains a reader section that could not be indexed.");
  } finally {
    parsed.zip.close();
  }
};

/**
 * Bytes for one reader asset, read out of the EPUB, or null when the archive
 * holds no such entry.
 *
 * Nothing lands on disk, so an archive entry whose name climbs out of the root
 * is no longer a write hazard — it is simply unreachable. Entry names and the
 * requested path normalize the same way, and `ensureSafeRelativePath` rejects
 * every spelling that survives normalization with a leading "../".
 */
export const readEpubReaderAsset = async (filePath: string, assetPath: string) => {
  const entryPath = ensureSafeRelativePath(assetPath);
  let zip: ZipFile;

  try {
    zip = await openPromise(filePath, {
      autoClose: false,
      lazyEntries: true,
      validateEntrySizes: true,
    });
  } catch {
    throw new AppError(400, "This file is not a valid EPUB archive.");
  }

  try {
    const entry = (await indexZipEntries(zip)).get(entryPath);
    if (!entry) return null;

    return await readZipEntry(zip, entry, MAX_EPUB_READER_ASSET_BYTES, "reader asset");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "This file is not a valid EPUB archive.");
  } finally {
    zip.close();
  }
};
