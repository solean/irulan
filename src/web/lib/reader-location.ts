import { isReaderTextWhitespace, normalizeReaderText } from "../../shared/reader-text";
import {
  READER_TEXT_VERSION,
  type ReaderTextRange,
} from "../../shared/types";

const READER_TEXT_CONTEXT_LENGTH = 48;
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

/** Serialize a non-empty DOM selection without retaining pagination or node paths. */
export const serializeReaderTextRange = (
  sectionHref: string,
  root: Element,
  selection: Range,
): ReaderTextRange | null => {
  const normalizedHref = sectionHref.trim();
  if (
    !normalizedHref ||
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
  if (offset === null || endOffset === null || endOffset <= offset) return null;

  const exact = map.text.slice(offset, endOffset);
  if (!exact.trim()) return null;

  return {
    sectionHref: normalizedHref,
    textVersion: READER_TEXT_VERSION,
    offset,
    endOffset,
    exact,
    prefix: map.text.slice(Math.max(0, offset - READER_TEXT_CONTEXT_LENGTH), offset),
    suffix: map.text.slice(endOffset, endOffset + READER_TEXT_CONTEXT_LENGTH),
  };
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
