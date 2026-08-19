import {
  createReaderTextLocation,
  createReaderTextRange,
  isReaderTextWhitespace,
  normalizeReaderText,
  READER_TEXT_CONTEXT_LENGTH,
} from "../../shared/reader-text";
import {
  READER_TEXT_VERSION,
  type ReaderTextLocation,
  type ReaderTextRange,
} from "../../shared/types";

const SHOW_TEXT = 4;

type TextSegment = {
  node: Text;
  rawStart: number;
  rawEnd: number;
};

type ReaderTextMap = {
  rawToCanonical: number[];
  segments: TextSegment[];
  text: string;
};

const containsBoundary = (root: Element, node: Node) => root === node || root.contains(node);

const buildReaderTextMap = (root: Element): ReaderTextMap => {
  const segments: TextSegment[] = [];
  const rawParts: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, SHOW_TEXT);
  let rawLength = 0;
  let current = walker.nextNode();

  while (current) {
    const node = current as Text;
    const value = node.data;
    if (value.length > 0) {
      segments.push({
        node,
        rawStart: rawLength,
        rawEnd: rawLength + value.length,
      });
      rawParts.push(value);
      rawLength += value.length;
    }
    current = walker.nextNode();
  }

  const raw = rawParts.join("");
  const rawToCanonical = new Array<number>(raw.length + 1);
  let text = "";
  let canonicalOffset = 0;
  let inWhitespace = false;

  for (let rawOffset = 0; rawOffset < raw.length; rawOffset += 1) {
    rawToCanonical[rawOffset] = canonicalOffset;
    const character = raw[rawOffset];

    if (isReaderTextWhitespace(character)) {
      if (!inWhitespace) {
        text += " ";
        canonicalOffset += 1;
        inWhitespace = true;
      }
      continue;
    }

    text += character;
    canonicalOffset += 1;
    inWhitespace = false;
  }
  rawToCanonical[raw.length] = canonicalOffset;

  return { rawToCanonical, segments, text };
};

const getRawBoundaryOffset = (root: Element, container: Node, offset: number) => {
  if (!containsBoundary(root, container)) return null;

  try {
    const preceding = root.ownerDocument.createRange();
    preceding.selectNodeContents(root);
    preceding.setEnd(container, offset);
    return preceding.toString().length;
  } catch {
    return null;
  }
};

const getCanonicalBoundaryOffset = (
  root: Element,
  map: ReaderTextMap,
  container: Node,
  offset: number,
) => {
  const rawOffset = getRawBoundaryOffset(root, container, offset);
  if (rawOffset === null || rawOffset < 0 || rawOffset >= map.rawToCanonical.length) {
    return null;
  }
  return map.rawToCanonical[rawOffset];
};

const getRawOffsetForCanonicalBoundary = (map: ReaderTextMap, offset: number) => {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > map.text.length) {
    return null;
  }

  let low = 0;
  let high = map.rawToCanonical.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (map.rawToCanonical[middle] <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const rawOffset = low - 1;
  return map.rawToCanonical[rawOffset] === offset ? rawOffset : null;
};

const getDomBoundary = (
  map: ReaderTextMap,
  rawOffset: number,
  bias: "start" | "end",
): { node: Text; offset: number } | null => {
  const first = map.segments[0];
  const last = map.segments.at(-1);
  if (!first || !last) return null;
  if (rawOffset <= 0) return { node: first.node, offset: 0 };
  if (rawOffset >= last.rawEnd) return { node: last.node, offset: last.node.data.length };

  for (const [index, segment] of map.segments.entries()) {
    if (rawOffset < segment.rawEnd) {
      return { node: segment.node, offset: rawOffset - segment.rawStart };
    }
    if (rawOffset === segment.rawEnd) {
      const next = map.segments[index + 1];
      if (bias === "start" && next?.rawStart === rawOffset) {
        return { node: next.node, offset: 0 };
      }
      return { node: segment.node, offset: segment.node.data.length };
    }
  }

  return null;
};

export const isReaderTextLocation = (value: unknown): value is ReaderTextLocation => {
  if (!value || typeof value !== "object") return false;
  const location = value as Partial<ReaderTextLocation>;
  return (
    location.textVersion === READER_TEXT_VERSION &&
    typeof location.sectionHref === "string" &&
    location.sectionHref.trim().length > 0 &&
    Number.isSafeInteger(location.offset) &&
    (location.offset ?? -1) >= 0 &&
    typeof location.prefix === "string" &&
    location.prefix.length <= READER_TEXT_CONTEXT_LENGTH &&
    typeof location.suffix === "string" &&
    location.suffix.length <= READER_TEXT_CONTEXT_LENGTH &&
    location.prefix.length + location.suffix.length > 0 &&
    normalizeReaderText(location.prefix) === location.prefix &&
    normalizeReaderText(location.suffix) === location.suffix
  );
};

const isReaderTextRange = (value: ReaderTextRange) =>
  value.textVersion === READER_TEXT_VERSION &&
  value.sectionHref.trim().length > 0 &&
  Number.isSafeInteger(value.offset) &&
  value.offset >= 0 &&
  Number.isSafeInteger(value.endOffset) &&
  value.endOffset > value.offset &&
  value.endOffset - value.offset === value.exact.length &&
  value.exact.length > 0 &&
  normalizeReaderText(value.exact) === value.exact &&
  normalizeReaderText(value.prefix) === value.prefix &&
  normalizeReaderText(value.suffix) === value.suffix;

const commonPrefixLength = (left: string, right: string) => {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (length < limit && left[length] === right[length]) length += 1;
  return length;
};

const commonSuffixLength = (left: string, right: string) => {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (length < limit && left[left.length - 1 - length] === right[right.length - 1 - length]) {
    length += 1;
  }
  return length;
};
const findLocationOffset = (text: string, location: ReaderTextLocation) => {
  const preceding = text.slice(
    Math.max(0, location.offset - location.prefix.length),
    location.offset,
  );
  const following = text.slice(location.offset, location.offset + location.suffix.length);
  if (preceding === location.prefix && following === location.suffix) {
    return location.offset;
  }

  const offsets = new Set<number>();
  const addOccurrences = (context: string, toOffset: (index: number) => number) => {
    if (!context) return;
    let index = text.indexOf(context);
    while (index >= 0) {
      offsets.add(toOffset(index));
      index = text.indexOf(context, index + 1);
    }
  };

  addOccurrences(location.prefix, (index) => index + location.prefix.length);
  addOccurrences(location.suffix, (index) => index);
  if (location.offset <= text.length) offsets.add(location.offset);

  const candidates = Array.from(offsets)
    .filter((offset) => offset >= 0 && offset <= text.length)
    .map((offset) => ({
      offset,
      score:
        commonSuffixLength(
          location.prefix,
          text.slice(Math.max(0, offset - location.prefix.length), offset),
        ) +
        commonPrefixLength(
          location.suffix,
          text.slice(offset, offset + location.suffix.length),
        ),
      distance: Math.abs(location.offset - offset),
    }))
    .sort((left, right) => right.score - left.score || left.distance - right.distance);

  const best = candidates[0];
  const runnerUp = candidates[1];
  const minimumScore = Math.min(
    12,
    Math.max(location.prefix.length, location.suffix.length),
  );
  if (
    !best ||
    best.score < minimumScore ||
    (runnerUp && runnerUp.score === best.score && runnerUp.distance === best.distance)
  ) {
    return null;
  }
  return best.offset;
};


const findQuoteOffset = (text: string, range: ReaderTextRange) => {
  const candidates: Array<{ offset: number; score: number; distance: number }> = [];
  let offset = text.indexOf(range.exact);

  while (offset >= 0) {
    const preceding = text.slice(Math.max(0, offset - range.prefix.length), offset);
    const following = text.slice(offset + range.exact.length, offset + range.exact.length + range.suffix.length);
    candidates.push({
      offset,
      score:
        commonSuffixLength(range.prefix, preceding) + commonPrefixLength(range.suffix, following),
      distance: Math.abs(range.offset - offset),
    });
    offset = text.indexOf(range.exact, offset + 1);
  }

  if (candidates.length === 0) return null;
  candidates.sort((left, right) => right.score - left.score || left.distance - right.distance);

  const best = candidates[0];
  const runnerUp = candidates[1];
  if (runnerUp && runnerUp.score === best.score && runnerUp.distance === best.distance) {
    return null;
  }
  return best.offset;
};

export const getCanonicalReaderText = (root: Element) => buildReaderTextMap(root).text;
/** Serialize one DOM boundary as a pagination-independent text point. */
export const serializeReaderTextLocation = (
  sectionHref: string,
  root: Element,
  boundary: Range,
): ReaderTextLocation | null => {
  if (
    !sectionHref.trim() ||
    boundary.startContainer.ownerDocument !== root.ownerDocument ||
    !containsBoundary(root, boundary.startContainer)
  ) {
    return null;
  }

  const map = buildReaderTextMap(root);
  const offset = getCanonicalBoundaryOffset(
    root,
    map,
    boundary.startContainer,
    boundary.startOffset,
  );
  return offset === null ? null : createReaderTextLocation(sectionHref, map.text, offset);
};


/** Serialize a non-empty DOM selection without retaining pagination or node paths. */
export const serializeReaderTextRange = (
  sectionHref: string,
  root: Element,
  selection: Range,
): ReaderTextRange | null => {
  if (
    !sectionHref.trim() ||
    selection.collapsed ||
    selection.startContainer.ownerDocument !== root.ownerDocument ||
    selection.endContainer.ownerDocument !== root.ownerDocument ||
    !containsBoundary(root, selection.startContainer) ||
    !containsBoundary(root, selection.endContainer)
  ) {
    return null;
  }

  const map = buildReaderTextMap(root);
  const offset = getCanonicalBoundaryOffset(
    root,
    map,
    selection.startContainer,
    selection.startOffset,
  );
  const endOffset = getCanonicalBoundaryOffset(
    root,
    map,
    selection.endContainer,
    selection.endOffset,
  );
  if (offset === null || endOffset === null) return null;

  return createReaderTextRange(sectionHref, map.text, offset, endOffset);
};

/** Resolve a stored text quote to the current rendered DOM, or fail without guessing. */
export const resolveReaderTextRange = (root: Element, stored: ReaderTextRange): Range | null => {
  if (!isReaderTextRange(stored)) return null;

  const map = buildReaderTextMap(root);
  const offset =
    map.text.slice(stored.offset, stored.endOffset) === stored.exact
      ? stored.offset
      : findQuoteOffset(map.text, stored);
  if (offset === null) return null;

  const endOffset = offset + stored.exact.length;
  const rawStart = getRawOffsetForCanonicalBoundary(map, offset);
  const rawEnd = getRawOffsetForCanonicalBoundary(map, endOffset);
  if (rawStart === null || rawEnd === null) return null;

  const start = getDomBoundary(map, rawStart, "start");
  const end = getDomBoundary(map, rawEnd, "end");
  if (!start || !end) return null;

  try {
    const resolved = root.ownerDocument.createRange();
    resolved.setStart(start.node, start.offset);
    resolved.setEnd(end.node, end.offset);
    return normalizeReaderText(resolved.toString()) === stored.exact ? resolved : null;
  } catch {
    return null;
  }
};

const resolveReaderTextLocationFromMap = (
  root: Element,
  map: ReaderTextMap,
  stored: ReaderTextLocation,
): Range | null => {
  if (!isReaderTextLocation(stored)) return null;

  const offset = findLocationOffset(map.text, stored);
  if (offset === null) return null;

  const rawOffset = getRawOffsetForCanonicalBoundary(map, offset);
  if (rawOffset === null) return null;
  const boundary = getDomBoundary(map, rawOffset, "start");
  if (!boundary) return null;

  try {
    const resolved = root.ownerDocument.createRange();
    resolved.setStart(boundary.node, boundary.offset);
    resolved.collapse(true);
    return resolved;
  } catch {
    return null;
  }
};

/** Resolve a stored text point to the current rendered DOM, or fail without guessing. */
export const resolveReaderTextLocation = (
  root: Element,
  stored: ReaderTextLocation,
): Range | null =>
  resolveReaderTextLocationFromMap(root, buildReaderTextMap(root), stored);

const locationClientRects = (location: Range) => {
  const container = location.startContainer;
  if (container.nodeType === 3) {
    const text = container as Text;
    if (location.startOffset < text.data.length) {
      const character = location.cloneRange();
      character.setEnd(text, location.startOffset + 1);
      const characterRects = Array.from(character.getClientRects());
      if (characterRects.some((bounds) => bounds.width > 0 || bounds.height > 0)) {
        return characterRects;
      }
    }
  }

  return Array.from(location.getClientRects());
};

/** Whether at least one stored text point belongs to the requested paginated page. */
export const hasReaderTextLocationOnPage = (
  root: Element,
  pageSpan: number,
  page: number,
  locations: readonly ReaderTextLocation[],
) => {
  if (
    locations.length === 0 ||
    !Number.isFinite(pageSpan) ||
    pageSpan <= 0 ||
    !Number.isSafeInteger(page) ||
    page < 1
  ) {
    return false;
  }

  const map = buildReaderTextMap(root);
  const rootBounds = root.getBoundingClientRect();
  return locations.some((stored) => {
    const resolved = resolveReaderTextLocationFromMap(root, map, stored);
    const targetBounds = resolved ? locationClientRects(resolved)[0] : undefined;
    if (!targetBounds) return false;

    const absoluteLeft = Math.max(0, targetBounds.left - rootBounds.left);
    return Math.floor(absoluteLeft / pageSpan) + 1 === page;
  });
};

/**
 * Whether the character at `offset` is laid out at or after the top-left corner
 * of the visible page. Collapsed characters carry no box, so they answer
 * `null` and the caller probes the next one.
 */
const isCharacterVisible = (measure: Range, node: Text, offset: number, viewport: DOMRect) => {
  measure.setStart(node, offset);
  measure.setEnd(node, offset + 1);
  const bounds = measure.getBoundingClientRect();
  if (bounds.width === 0 && bounds.height === 0) return null;
  return bounds.right > viewport.left + 0.5 && bounds.bottom > viewport.top + 0.5;
};

/**
 * First character of `node` that the viewport shows. Text order follows column
 * and line order, so the visible run starts at a single boundary a binary
 * search can find. The boundary is measured inside the node instead of hit
 * testing the document, which would answer with whatever panel or toolbar sits
 * above the text.
 */
const findFirstVisibleOffset = (node: Text, viewport: DOMRect) => {
  const measure = node.ownerDocument.createRange();
  let low = 0;
  let high = node.data.length - 1;
  let found: number | null = null;

  while (low <= high) {
    const middle = (low + high) >> 1;
    let probe = middle;
    let visible = isCharacterVisible(measure, node, probe, viewport);
    while (visible === null && probe < high) {
      probe += 1;
      visible = isCharacterVisible(measure, node, probe, viewport);
    }

    if (visible === true) {
      found = probe;
      high = middle - 1;
    } else {
      low = probe + 1;
    }
  }

  return found;
};

/**
 * Capture the first visible text point in the current paginated viewport.
 * Layout is consulted only to choose the point; the returned value contains no
 * page or geometry data.
 */
export const serializeReaderViewportLocation = (
  sectionHref: string,
  root: Element,
  viewport: Element,
): ReaderTextLocation | null => {
  const viewportBounds = viewport.getBoundingClientRect();
  const walker = root.ownerDocument.createTreeWalker(root, SHOW_TEXT);
  let best: { left: number; node: Text; top: number } | null = null;
  let current = walker.nextNode();

  while (current) {
    const node = current as Text;
    if (node.data.length > 0) {
      const contents = root.ownerDocument.createRange();
      contents.selectNodeContents(node);
      for (const bounds of contents.getClientRects()) {
        const left = Math.max(bounds.left, viewportBounds.left);
        const right = Math.min(bounds.right, viewportBounds.right);
        const top = Math.max(bounds.top, viewportBounds.top);
        const bottom = Math.min(bounds.bottom, viewportBounds.bottom);
        if (right > left && bottom > top) {
          const candidate = { left, node, top };
          if (
            !best ||
            candidate.top < best.top - 0.5 ||
            (Math.abs(candidate.top - best.top) <= 0.5 && candidate.left < best.left)
          ) {
            best = candidate;
          }
        }
      }
    }
    current = walker.nextNode();
  }

  if (!best) return null;
  const offset = findFirstVisibleOffset(best.node, viewportBounds);
  if (offset === null) return null;

  const boundary = root.ownerDocument.createRange();
  boundary.setStart(best.node, offset);
  boundary.collapse(true);
  return serializeReaderTextLocation(sectionHref, root, boundary);
};
