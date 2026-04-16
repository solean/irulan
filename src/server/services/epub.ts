import path from "node:path";

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";

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

type ExtractedEpub = {
  title: string | null;
  author: string | null;
  coverBuffer: Uint8Array | null;
  coverExtension: string | null;
};

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

const resolveRelativeZipPath = (opfPath: string, href: string) =>
  path.posix.normalize(path.posix.join(path.posix.dirname(opfPath), href));

export const extractEpubMetadata = async (
  fileBytes: Uint8Array,
): Promise<ExtractedEpub> => {
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

  const opf = parser.parse(opfXml);
  const metadata = opf.package?.metadata ?? {};
  const manifestItems = asArray<ManifestItem>(opf.package?.manifest?.item);
  const metaItems = asArray<MetaItem>(metadata.meta);

  const title = asText(metadata.title);
  const author = asText(asArray(metadata.creator)[0]);

  const coverId =
    metaItems.find((item) => item["@_name"] === "cover")?.["@_content"] ?? null;

  const coverItem =
    manifestItems.find((item) => item["@_properties"]?.includes("cover-image")) ??
    manifestItems.find((item) => item["@_id"] === coverId) ??
    manifestItems.find(
      (item) =>
        item["@_media-type"]?.startsWith("image/") &&
        item["@_href"]?.toLowerCase().includes("cover"),
    ) ??
    null;

  if (!coverItem?.["@_href"]) {
    return {
      title,
      author,
      coverBuffer: null,
      coverExtension: null,
    };
  }

  const coverZipPath = resolveRelativeZipPath(opfPath, coverItem["@_href"]);
  const coverFile = zip.file(coverZipPath);

  if (!coverFile) {
    return {
      title,
      author,
      coverBuffer: null,
      coverExtension: null,
    };
  }

  return {
    title,
    author,
    coverBuffer: await coverFile.async("uint8array"),
    coverExtension: extensionFromManifest(coverItem),
  };
};
