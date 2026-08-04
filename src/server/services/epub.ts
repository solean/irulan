import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { openPromise, type Entry, type ZipFile } from "yauzl";

import type { BookReaderSection } from "../../shared/types";
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

type ParsedEpub = {
  zip: JSZip;
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


const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
});

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

const parsePackage = (opfXml: string, opfPath: string): Omit<ParsedEpub, "zip" | "opfPath"> => {
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

const parseEpub = async (fileBytes: Uint8Array): Promise<ParsedEpub> => {
  let zip: JSZip;

  try {
    zip = await JSZip.loadAsync(fileBytes);
  } catch {
    throw new AppError(400, "This file is not a valid EPUB archive.");
  }

  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) {
    throw new AppError(400, "The EPUB is missing META-INF/container.xml.");
  }

  const container = parser.parse(containerXml);
  const rootFile = asArray(container.container?.rootfiles?.rootfile)[0];
  const opfPath = rootFile?.["@_full-path"];

  if (!opfPath || typeof opfPath !== "string") {
    throw new AppError(400, "The EPUB package file could not be located.");
  }

  const opfXml = await zip.file(opfPath)?.async("string");
  if (!opfXml) {
    throw new AppError(400, "The EPUB package file is missing.");
  }

  return {
    zip,
    opfPath,
    ...parsePackage(opfXml, opfPath),
  };
};

const extractTocLabelsFromNav = async (parsed: ParsedEpub) => {
  if (!parsed.navPath) return new Map<string, string>();

  const navXml = await parsed.zip.file(parsed.navPath)?.async("string");
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

  const ncxXml = await parsed.zip.file(parsed.ncxPath)?.async("string");
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
  const sectionXml = await parsed.zip.file(sectionPath)?.async("string");
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

const buildReaderSections = async (
  parsed: ParsedEpub,
  bookId: string,
): Promise<BookReaderSection[]> => {
  const sections: BookReaderSection[] = [];
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
      url: `/api/books/${bookId}/read/${encodeAssetPath(zipPath)}`,
    });
  }

  return sections;
};

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
const contentDirectory = (readerDir: string) => path.join(readerDir, "content");

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
      const firstSection = parsed.sections[0];
      if (firstSection) {
        await readFile(path.join(contentDirectory(readerDir), normalizeZipPath(firstSection.href)));
      }

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
    const parsed = parsePackage(opfXml, opfPath);
    const coverItem = selectCoverItem(parsed.manifestItems, parsed.metaItems);
    if (!coverItem?.["@_href"]) {
      return {
        title: parsed.title,
        author: parsed.author,
        coverBuffer: null,
        coverExtension: null,
      };
    }

    const coverZipPath = normalizeZipPath(
      resolveRelativeZipPath(opfPath, coverItem["@_href"]),
    );
    const coverEntry = entries.get(coverZipPath);
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
      coverBuffer: await readZipEntry(zip, coverEntry, MAX_EPUB_COVER_BYTES, "cover image"),
      coverExtension: extensionFromManifest(coverItem),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "This file is not a valid EPUB archive.");
  } finally {
    zip.close();
  }
};

export const prepareEpubReader = async (
  filePath: string,
  readerDir: string,
  bookId: string,
): Promise<ReaderManifest> => {
  const cached = await readCachedReaderManifest(readerDir);
  if (cached) return cached;

  const fileBytes = await readFile(filePath);
  const parsed = await parseEpub(fileBytes);
  const sections = await buildReaderSections(parsed, bookId);

  if (sections.length === 0) {
    throw new AppError(400, "This EPUB does not expose readable spine sections.");
  }

  const manifest: ReaderManifest = {
    title: parsed.title ?? "Untitled Book",
    author: parsed.author ?? "Unknown Author",
    sections,
  };

  const extractedContentDir = contentDirectory(readerDir);
  await rm(readerDir, { recursive: true, force: true });
  await mkdir(extractedContentDir, { recursive: true });

  for (const entry of Object.values(parsed.zip.files)) {
    if (entry.dir) continue;

    // Drop an entry whose name would land outside the reader directory rather
    // than failing the extraction. Throwing here aborted the whole book after
    // the reader directory had already been cleared, so one odd name made an
    // otherwise readable EPUB report itself as invalid.
    //
    // Only the path is treated this way. A write that fails for other reasons —
    // a full disk above all — must still surface, or a half-extracted book gets
    // cached behind a manifest that claims it is complete.
    const relativePath = safeRelativePath(entry.name);
    if (!relativePath) {
      console.warn(`Skipped an unsafe entry in ${bookId}: ${entry.name}`);
      continue;
    }

    const targetPath = path.join(extractedContentDir, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, await entry.async("uint8array"));
  }

  await writeFile(manifestPath(readerDir), JSON.stringify(manifest, null, 2));
  return manifest;
};

export const resolveEpubReaderAssetPath = (readerDir: string, assetPath: string) =>
  path.join(contentDirectory(readerDir), ensureSafeRelativePath(assetPath));
