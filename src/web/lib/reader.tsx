import type { MouseEvent, ReactNode } from "react";

import type { BookReaderSection } from "../../shared/types";

export type ReaderLinkTarget =
  | {
      kind: "external";
      href: string;
    }
  | {
      kind: "internal";
      href: string;
      anchor: string | null;
    }
  | {
      kind: "invalid";
    };

type ReaderRenderOptions = {
  bookId: string;
  document: Document;
  section: BookReaderSection;
  onInternalLinkClick: (
    event: MouseEvent<HTMLAnchorElement>,
    target: Extract<ReaderLinkTarget, { kind: "internal" }>,
  ) => void;
};

const READER_ASSET_PREFIX = (bookId: string) => `/api/books/${bookId}/read/`;

const prettifyReaderLabel = (href: string) =>
  href
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (character) => character.toUpperCase()) || "Linked section";

const encodeReaderAssetHref = (href: string) =>
  href
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const collapseWhitespace = (value: string) => value.replace(/\s+/g, " ");

const getNodeText = (node: Node, preserveWhitespace = false): string | null => {
  const value = node.textContent ?? "";
  if (preserveWhitespace) {
    return value ? value : null;
  }

  const normalized = collapseWhitespace(value);
  if (!normalized.trim()) {
    return normalized.includes(" ") ? " " : null;
  }

  return normalized;
};

const getElementAnchorId = (element: Element) =>
  element.getAttribute("id") ?? element.getAttribute("name") ?? undefined;

const getAssetHrefFromPathname = (bookId: string, pathname: string) => {
  const prefix = READER_ASSET_PREFIX(bookId);
  if (!pathname.startsWith(prefix)) return null;
  return decodeURIComponent(pathname.slice(prefix.length));
};

const resolveAssetUrl = (section: BookReaderSection, rawHref: string) => {
  try {
    return new URL(rawHref, new URL(section.url, window.location.origin)).toString();
  } catch {
    return null;
  }
};

const getInlineSvgUrl = (element: Element) => {
  try {
    const serializer = new XMLSerializer();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      serializer.serializeToString(element),
    )}`;
  } catch {
    return null;
  }
};

const getReaderLinkTarget = (
  bookId: string,
  section: BookReaderSection,
  rawHref: string | null,
): ReaderLinkTarget => {
  if (!rawHref) return { kind: "invalid" };

  const trimmed = rawHref.trim();
  if (!trimmed) return { kind: "invalid" };
  if (/^javascript:/i.test(trimmed)) return { kind: "invalid" };
  if (/^(mailto:|tel:)/i.test(trimmed)) return { kind: "external", href: trimmed };

  try {
    const resolved = new URL(trimmed, new URL(section.url, window.location.origin));
    if (resolved.origin !== window.location.origin) {
      return { kind: "external", href: resolved.toString() };
    }

    const href = getAssetHrefFromPathname(bookId, resolved.pathname);
    if (!href) {
      return { kind: "external", href: resolved.toString() };
    }

    return {
      kind: "internal",
      href,
      anchor: resolved.hash ? decodeURIComponent(resolved.hash.slice(1)) : null,
    };
  } catch {
    return { kind: "invalid" };
  }
};

const buildReaderRouteHref = (bookId: string, href: string, anchor: string | null) => {
  const params = new URLSearchParams();
  params.set("section", href);

  if (anchor) {
    params.set("anchor", anchor);
  }

  return `/books/${bookId}/read?${params.toString()}`;
};

const renderChildren = (
  nodes: NodeListOf<ChildNode> | ChildNode[],
  options: ReaderRenderOptions,
  path: string,
  mode: "block" | "inline" | "pre",
): ReactNode[] => {
  const rendered = Array.from(nodes)
    .map((node, index) => renderNode(node, options, `${path}-${index}`, mode))
    .filter((value) => value !== null);

  return rendered;
};

const renderNode = (
  node: ChildNode,
  options: ReaderRenderOptions,
  path: string,
  mode: "block" | "inline" | "pre",
): ReactNode | null => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = getNodeText(node, mode === "pre");
    if (mode === "block" && (!text || !text.trim())) {
      return null;
    }

    return text;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const anchorId = getElementAnchorId(element);
  const childrenMode = tag === "pre" ? "pre" : mode === "pre" ? "pre" : "inline";
  const inlineChildren = renderChildren(element.childNodes, options, path, childrenMode);
  const blockChildren = renderChildren(element.childNodes, options, path, "block");

  if (["script", "style", "link", "meta", "head", "title"].includes(tag)) {
    return null;
  }

  switch (tag) {
    case "body":
      return <>{blockChildren}</>;
    case "section":
    case "article":
    case "main":
    case "header":
    case "footer":
    case "aside":
    case "nav":
    case "div":
      if (mode === "inline") {
        return (
          <span className="reader-inline-group" id={anchorId} key={path}>
            {inlineChildren}
          </span>
        );
      }

      return (
        <section className="reader-group" id={anchorId} key={path}>
          {blockChildren}
        </section>
      );
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const HeadingTag = tag;
      return (
        <HeadingTag className={`reader-heading reader-heading-${tag}`} id={anchorId} key={path}>
          {inlineChildren}
        </HeadingTag>
      );
    }
    case "p":
      if (inlineChildren.length === 0) return null;
      return (
        <p className="reader-paragraph" id={anchorId} key={path}>
          {inlineChildren}
        </p>
      );
    case "blockquote":
      return (
        <blockquote className="reader-blockquote" id={anchorId} key={path}>
          {blockChildren}
        </blockquote>
      );
    case "figure":
      return (
        <figure className="reader-figure" id={anchorId} key={path}>
          {blockChildren}
        </figure>
      );
    case "figcaption":
      return (
        <figcaption className="reader-figcaption" id={anchorId} key={path}>
          {inlineChildren}
        </figcaption>
      );
    case "img": {
      const src = element.getAttribute("src");
      const resolvedSrc = src ? resolveAssetUrl(options.section, src) : null;
      if (!resolvedSrc) return null;

      const width = Number.parseInt(element.getAttribute("width") ?? "", 10);
      const height = Number.parseInt(element.getAttribute("height") ?? "", 10);

      if (mode === "inline") {
        return (
          <img
            alt={element.getAttribute("alt") ?? ""}
            className="reader-inline-image"
            height={Number.isFinite(height) ? height : undefined}
            key={path}
            loading="lazy"
            src={resolvedSrc}
            width={Number.isFinite(width) ? width : undefined}
          />
        );
      }

      return (
        <figure className="reader-figure" id={anchorId} key={path}>
          <img
            alt={element.getAttribute("alt") ?? ""}
            className="reader-image"
            height={Number.isFinite(height) ? height : undefined}
            loading="lazy"
            src={resolvedSrc}
            width={Number.isFinite(width) ? width : undefined}
          />
        </figure>
      );
    }
    case "svg": {
      const svgUrl = getInlineSvgUrl(element);
      if (!svgUrl) return null;

      return (
        <figure className="reader-figure" id={anchorId} key={path}>
          <img alt="" aria-hidden="true" className="reader-image" loading="lazy" src={svgUrl} />
        </figure>
      );
    }
    case "hr":
      return <hr className="reader-divider" id={anchorId} key={path} />;
    case "ul":
      return (
        <ul className="reader-list" id={anchorId} key={path}>
          {blockChildren}
        </ul>
      );
    case "ol": {
      const start = Number.parseInt(element.getAttribute("start") ?? "", 10);
      return (
        <ol
          className="reader-list reader-list-ordered"
          id={anchorId}
          key={path}
          start={Number.isFinite(start) ? start : undefined}
        >
          {blockChildren}
        </ol>
      );
    }
    case "li":
      return (
        <li className="reader-list-item" id={anchorId} key={path}>
          {blockChildren.length > 0 ? blockChildren : inlineChildren}
        </li>
      );
    case "pre":
      return (
        <pre className="reader-pre" id={anchorId} key={path}>
          {renderChildren(element.childNodes, options, path, "pre")}
        </pre>
      );
    case "code":
      if (mode === "pre") {
        return <code key={path}>{renderChildren(element.childNodes, options, path, "pre")}</code>;
      }

      return (
        <code className="reader-inline-code" id={anchorId} key={path}>
          {inlineChildren}
        </code>
      );
    case "table":
      return (
        <div className="reader-table-wrap" id={anchorId} key={path}>
          <table className="reader-table">{blockChildren}</table>
        </div>
      );
    case "thead":
    case "tbody":
    case "tfoot": {
      const TableSectionTag = tag;
      return <TableSectionTag key={path}>{blockChildren}</TableSectionTag>;
    }
    case "tr":
      return <tr key={path}>{blockChildren}</tr>;
    case "th":
    case "td": {
      const TableCellTag = tag;
      const colSpan = Number.parseInt(element.getAttribute("colspan") ?? "", 10);
      const rowSpan = Number.parseInt(element.getAttribute("rowspan") ?? "", 10);

      return (
        <TableCellTag
          colSpan={Number.isFinite(colSpan) ? colSpan : undefined}
          id={anchorId}
          key={path}
          rowSpan={Number.isFinite(rowSpan) ? rowSpan : undefined}
        >
          {blockChildren.length > 0 ? blockChildren : inlineChildren}
        </TableCellTag>
      );
    }
    case "caption":
      return <caption key={path}>{inlineChildren}</caption>;
    case "a": {
      const linkTarget = getReaderLinkTarget(
        options.bookId,
        options.section,
        element.getAttribute("href"),
      );
      const href =
        linkTarget.kind === "external"
          ? linkTarget.href
          : linkTarget.kind === "internal"
            ? buildReaderRouteHref(options.bookId, linkTarget.href, linkTarget.anchor)
            : "#";

      return (
        <a
          className="reader-link"
          href={href}
          id={anchorId}
          key={path}
          onClick={
            linkTarget.kind === "internal"
              ? (event) => options.onInternalLinkClick(event, linkTarget)
              : linkTarget.kind === "invalid"
                ? (event) => event.preventDefault()
                : undefined
          }
          rel={linkTarget.kind === "external" ? "noreferrer" : undefined}
          target={linkTarget.kind === "external" ? "_blank" : undefined}
        >
          {inlineChildren}
        </a>
      );
    }
    case "em":
    case "i":
      return (
        <em id={anchorId} key={path}>
          {inlineChildren}
        </em>
      );
    case "strong":
    case "b":
      return (
        <strong id={anchorId} key={path}>
          {inlineChildren}
        </strong>
      );
    case "sup":
      return (
        <sup id={anchorId} key={path}>
          {inlineChildren}
        </sup>
      );
    case "sub":
      return (
        <sub id={anchorId} key={path}>
          {inlineChildren}
        </sub>
      );
    case "small":
      return (
        <small id={anchorId} key={path}>
          {inlineChildren}
        </small>
      );
    case "mark":
      return (
        <mark className="reader-mark" id={anchorId} key={path}>
          {inlineChildren}
        </mark>
      );
    case "br":
      return <br key={path} />;
    case "span":
    case "cite":
    case "abbr":
    case "time":
    case "del":
    case "ins":
    case "s":
    case "u":
      return (
        <span id={anchorId} key={path}>
          {inlineChildren}
        </span>
      );
    default:
      if (mode === "inline") {
        return (
          <span id={anchorId} key={path}>
            {inlineChildren}
          </span>
        );
      }

      return (
        <div className="reader-group" id={anchorId} key={path}>
          {blockChildren.length > 0 ? blockChildren : inlineChildren}
        </div>
      );
  }
};

export const buildReaderAssetUrl = (bookId: string, href: string) =>
  `${READER_ASSET_PREFIX(bookId)}${encodeReaderAssetHref(href)}`;

export const createReaderAssetSection = (bookId: string, href: string): BookReaderSection => ({
  id: `asset:${href}`,
  href,
  label: prettifyReaderLabel(href),
  url: buildReaderAssetUrl(bookId, href),
});

export const getReaderDocumentTitle = (document: Document) => {
  const selectors = ["title", "body h1", "body h2", "body header h1", "body header h2"];
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.textContent?.trim();
    if (value) return value;
  }

  return null;
};

export const renderReaderDocument = ({
  bookId,
  document,
  section,
  onInternalLinkClick,
}: ReaderRenderOptions): ReactNode[] =>
  renderChildren(document.body?.childNodes ?? document.documentElement.childNodes, {
    bookId,
    document,
    onInternalLinkClick,
    section,
  }, "reader", "block");
