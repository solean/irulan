import {
  READER_TEXT_VERSION,
  type ReaderTextRange,
} from "./types";

const READER_WHITESPACE_PATTERN = /\s/u;
const READER_WHITESPACE_RUN_PATTERN = /\s+/gu;

export const READER_TEXT_CONTEXT_LENGTH = 48;

export const isReaderTextWhitespace = (value: string) => READER_WHITESPACE_PATTERN.test(value);

/**
 * Canonical text used by stable locations and search.
 *
 * Whitespace is the only normalization in version 1. It preserves case,
 * punctuation, Unicode spelling, and UTF-16 offsets while removing layout-only
 * differences between equivalent EPUB markup.
 */
export const normalizeReaderText = (value: string) =>
  value.replace(READER_WHITESPACE_RUN_PATTERN, " ");

export const createReaderTextRange = (
  sectionHref: string,
  text: string,
  offset: number,
  endOffset: number,
): ReaderTextRange | null => {
  const normalizedHref = sectionHref.trim();
  if (
    !normalizedHref ||
    normalizeReaderText(text) !== text ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(endOffset) ||
    endOffset <= offset ||
    endOffset > text.length
  ) {
    return null;
  }

  const exact = text.slice(offset, endOffset);
  if (!exact.trim()) return null;

  return {
    sectionHref: normalizedHref,
    textVersion: READER_TEXT_VERSION,
    offset,
    endOffset,
    exact,
    prefix: text.slice(Math.max(0, offset - READER_TEXT_CONTEXT_LENGTH), offset),
    suffix: text.slice(endOffset, endOffset + READER_TEXT_CONTEXT_LENGTH),
  };
};
