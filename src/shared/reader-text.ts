const READER_WHITESPACE_PATTERN = /\s/u;
const READER_WHITESPACE_RUN_PATTERN = /\s+/gu;

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
