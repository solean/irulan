import { eq, sql } from "drizzle-orm";

import { createReaderTextRange, normalizeReaderText } from "../../shared/reader-text";
import {
  BOOK_SEARCH_PAGE_SIZE,
  MAX_BOOK_SEARCH_PAGE_SIZE,
  MAX_BOOK_SEARCH_QUERY_LENGTH,
  READER_TEXT_VERSION,
  type BookSearchPage,
  type BookSearchResult,
} from "../../shared/types";
import { db } from "../db/client";
import { books, readerSectionText } from "../db/schema";
import { AppError } from "../errors";
import { extractEpubReaderTextSections } from "./epub";

const FTS_START_MARKER = "\u0001";
const FTS_END_MARKER = "\u0002";
const MAX_SEARCH_SNIPPET_LENGTH = 240;
const SEARCH_TOKEN_PATTERN = /[\p{L}\p{M}\p{N}]+/gu;

type SearchOptions = {
  query: string;
  offset?: number;
  limit?: number;
};

type SearchRow = {
  href: string;
  label: string;
  spineIndex: number;
  text: string;
  highlighted: string;
};

type SearchCountRow = {
  total: number;
};

const pendingIndexRequests = new Map<string, Promise<void>>();

const currentIndexExists = (bookId: string) => {
  const versions = db
    .select({ textVersion: readerSectionText.textVersion })
    .from(readerSectionText)
    .where(eq(readerSectionText.bookId, bookId))
    .all();

  return (
    versions.length > 0 && versions.every(({ textVersion }) => textVersion === READER_TEXT_VERSION)
  );
};

const buildBookSearchIndex = async (bookId: string) => {
  const book = db
    .select({ filePath: books.filePath })
    .from(books)
    .where(eq(books.id, bookId))
    .get();
  if (!book) throw new AppError(404, "Book not found.");

  const sections = await extractEpubReaderTextSections(book.filePath);
  const indexedAt = new Date();

  db.transaction((tx) => {
    tx.delete(readerSectionText).where(eq(readerSectionText.bookId, bookId)).run();
    tx.insert(readerSectionText)
      .values(
        sections.map((section) => ({
          bookId,
          href: section.href,
          label: section.label,
          spineIndex: section.spineIndex,
          textVersion: section.textVersion,
          text: section.text,
          indexedAt,
        })),
      )
      .run();
  });
};

export const ensureBookSearchIndex = async (bookId: string) => {
  if (currentIndexExists(bookId)) return;

  const pending = pendingIndexRequests.get(bookId);
  if (pending) return pending;

  const request = buildBookSearchIndex(bookId);
  pendingIndexRequests.set(bookId, request);

  try {
    await request;
  } finally {
    if (pendingIndexRequests.get(bookId) === request) {
      pendingIndexRequests.delete(bookId);
    }
  }
};

/** Start derived indexing after import; a later search retries any failed or interrupted work. */
export const queueBookSearchIndex = (bookId: string) => {
  void ensureBookSearchIndex(bookId).catch((error) => {
    console.warn(`Could not build the search index for book ${bookId}.`, error);
  });
};

const toFtsQuery = (query: string) => {
  const tokens = query.match(SEARCH_TOKEN_PATTERN) ?? [];
  return tokens.length > 0 ? tokens.map((token) => `"${token}"`).join(" AND ") : null;
};

const matchedRange = (row: SearchRow) => {
  if (row.text.includes(FTS_START_MARKER) || row.text.includes(FTS_END_MARKER)) {
    throw new AppError(500, "This book contains text that cannot be safely searched.");
  }

  const markedStart = row.highlighted.indexOf(FTS_START_MARKER);
  const markedEnd = row.highlighted.indexOf(FTS_END_MARKER, markedStart + 1);
  if (markedStart < 0 || markedEnd <= markedStart) {
    throw new AppError(500, "The search index returned a result without a text location.");
  }

  const preceding = row.highlighted
    .slice(0, markedStart)
    .replaceAll(FTS_START_MARKER, "")
    .replaceAll(FTS_END_MARKER, "");
  const exact = row.highlighted
    .slice(markedStart + FTS_START_MARKER.length, markedEnd)
    .replaceAll(FTS_START_MARKER, "")
    .replaceAll(FTS_END_MARKER, "");
  const offset = preceding.length;
  const range = createReaderTextRange(row.href, row.text, offset, offset + exact.length);
  if (!range) {
    throw new AppError(500, "The search index returned an invalid text location.");
  }
  return range;
};

const searchSnippet = (text: string, result: BookSearchResult["range"]) => {
  const contextLength = Math.max(0, MAX_SEARCH_SNIPPET_LENGTH - result.exact.length);
  const beforeLength = Math.floor(contextLength / 2);
  const start = Math.max(0, result.offset - beforeLength);
  const end = Math.min(text.length, result.endOffset + contextLength - (result.offset - start));
  return `${start > 0 ? "… " : ""}${text.slice(start, end)}${end < text.length ? " …" : ""}`;
};

export const searchBook = async (
  bookId: string,
  options: SearchOptions,
): Promise<BookSearchPage> => {
  const query = normalizeReaderText(options.query).trim();
  if (!query) throw new AppError(400, "Enter text to search for.");
  if (query.length > MAX_BOOK_SEARCH_QUERY_LENGTH) {
    throw new AppError(
      400,
      `Search text must be ${MAX_BOOK_SEARCH_QUERY_LENGTH} characters or fewer.`,
    );
  }

  const offset = options.offset ?? 0;
  const limit = options.limit ?? BOOK_SEARCH_PAGE_SIZE;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new AppError(400, "Search offset must be a non-negative integer.");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BOOK_SEARCH_PAGE_SIZE) {
    throw new AppError(400, `Search limit must be between 1 and ${MAX_BOOK_SEARCH_PAGE_SIZE}.`);
  }

  await ensureBookSearchIndex(bookId);

  const ftsQuery = toFtsQuery(query);
  if (!ftsQuery) {
    return { query, results: [], offset, limit, total: 0 };
  }

  const count = db.get<SearchCountRow>(sql`
    SELECT count(*) AS total
    FROM reader_section_fts
    JOIN reader_section_text AS section ON section.id = reader_section_fts.rowid
    WHERE reader_section_fts MATCH ${ftsQuery}
      AND section.book_id = ${bookId}
  `);
  const rows = db.all<SearchRow>(sql`
    SELECT
      section.href,
      section.label,
      section.spine_index AS spineIndex,
      section.text,
      highlight(reader_section_fts, 0, ${FTS_START_MARKER}, ${FTS_END_MARKER}) AS highlighted
    FROM reader_section_fts
    JOIN reader_section_text AS section ON section.id = reader_section_fts.rowid
    WHERE reader_section_fts MATCH ${ftsQuery}
      AND section.book_id = ${bookId}
    ORDER BY section.spine_index ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  const results = rows.map((row): BookSearchResult => {
    const range = matchedRange(row);
    return {
      sectionHref: row.href,
      sectionLabel: row.label,
      spineIndex: row.spineIndex,
      snippet: searchSnippet(row.text, range),
      range,
    };
  });

  return {
    query,
    results,
    offset,
    limit,
    total: count?.total ?? 0,
  };
};
