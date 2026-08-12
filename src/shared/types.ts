export const READ_STATUSES = ["unread", "reading", "finished"] as const;

export type ReadStatus = (typeof READ_STATUSES)[number];

export const BOOK_SORT_KEYS = [
  "title",
  "author",
  "sourceFilename",
  "importedAt",
  "fileSizeBytes",
  "readStatus",
  "rating",
] as const;

export type BookSortKey = (typeof BOOK_SORT_KEYS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;

export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const BOOKS_PAGE_SIZE = 60;
export const MAX_BOOKS_PAGE_SIZE = 100;

export type BookshelfSummary = {
  id: string;
  name: string;
  kindleEmail: string | null;
  bookCount: number;
  createdAt: string;
};

/**
 * The shelf list plus the size of the library as a whole.
 *
 * `libraryBookCount` cannot be derived by summing `bookCount`: a book on two
 * shelves is counted by both, and a book on no shelf is counted by none.
 */
export type BookshelvesPayload = {
  bookshelves: BookshelfSummary[];
  libraryBookCount: number;
};

export type BookSummary = {
  id: string;
  title: string;
  author: string;
  sourceFilename: string;
  fileSizeBytes: number;
  importedAt: string;
  coverUrl: string | null;
  readStatus: ReadStatus;
  rating: number | null;
  bookshelves: BookshelfSummary[];
};

export type BookDetail = BookSummary;

export type BookListOptions = {
  query?: string;
  bookshelfId?: string | null;
  readStatus?: ReadStatus | null;
  sort?: BookSortKey;
  direction?: SortDirection;
  offset?: number;
  limit?: number;
};

export type BookPage = {
  books: BookSummary[];
  offset: number;
  limit: number;
  total: number;
  unfilteredTotal: number;
  statusCounts: Record<ReadStatus | "all", number>;
};

export type UpdateBookMetadataPayload = {
  readStatus?: ReadStatus;
  rating?: number | null;
};

export type BookReaderSection = {
  id: string;
  href: string;
  label: string;
  url: string;
};

export type BookReader = {
  id: string;
  title: string;
  author: string;
  sections: BookReaderSection[];
};

export const READER_TEXT_VERSION = 1 as const;

/**
 * A pagination-independent point in the canonical text of one spine section.
 *
 * Offsets use JavaScript UTF-16 code units. Prefix and suffix make the point
 * recoverable when preceding text shifts without storing layout-dependent data.
 */
export type ReaderTextLocation = {
  sectionHref: string;
  textVersion: typeof READER_TEXT_VERSION;
  offset: number;
  prefix: string;
  suffix: string;
};

/**
 * A non-empty text selection beginning at `offset` and ending at `endOffset`.
 * `exact` is the canonical selected text and is also the quote selector used
 * to validate or re-anchor the stored offsets.
 */
export type ReaderTextRange = ReaderTextLocation & {
  endOffset: number;
  exact: string;
};

export const BOOK_SEARCH_PAGE_SIZE = 20;
export const MAX_BOOK_SEARCH_PAGE_SIZE = 50;
export const MAX_BOOK_SEARCH_QUERY_LENGTH = 200;

export type BookSearchResult = {
  sectionHref: string;
  sectionLabel: string;
  spineIndex: number;
  snippet: string;
  range: ReaderTextRange;
};

export type BookSearchPage = {
  query: string;
  results: BookSearchResult[];
  offset: number;
  limit: number;
  total: number;
};

export const MAX_READER_SECTION_HREF_LENGTH = 2_048;
export const MAX_READER_BOOKMARK_LABEL_LENGTH = 160;
export const READER_ANNOTATION_COLORS = ["yellow", "green", "blue", "pink"] as const;
export const MAX_READER_ANNOTATION_NOTE_LENGTH = 10_000;
export const MAX_READER_ANNOTATION_QUOTE_LENGTH = 50_000;

export type ReaderAnnotationColor = (typeof READER_ANNOTATION_COLORS)[number];

export type ReaderBookmark = {
  id: string;
  bookId: string;
  label: string | null;
  location: ReaderTextLocation;
  createdAt: string;
  updatedAt: string;
};

export type CreateReaderBookmarkPayload = {
  location: ReaderTextLocation;
  label?: string | null;
};

export type UpdateReaderBookmarkPayload = {
  label: string | null;
};

export type ReaderAnnotation = {
  id: string;
  bookId: string;
  range: ReaderTextRange;
  color: ReaderAnnotationColor;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateReaderAnnotationPayload = {
  range: ReaderTextRange;
  color: ReaderAnnotationColor;
  note?: string | null;
};

export type UpdateReaderAnnotationPayload = {
  color?: ReaderAnnotationColor;
  note?: string | null;
};

export type DeliveryRecord = {
  id: string;
  bookshelfId: string | null;
  recipientEmail: string;
  status: "pending" | "sent" | "failed";
  errorMessage: string | null;
  smtpMessageId: string | null;
  createdAt: string;
  sentAt: string | null;
};

export type SmtpPasswordSource = "app" | "environment" | "none";

export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  hasPassword: boolean;
  passwordSource: SmtpPasswordSource;
  configured: boolean;
  source: "app" | "environment";
};

export type UpdateSmtpSettingsPayload = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password?: string;
  clearPassword?: boolean;
  from: string;
};

/**
 * Recorded when the library had to be restored from its `.bak` copy at startup.
 *
 * `backupModifiedAt` is the backup file's mtime — the point in time the restored
 * data is current as of, which is the only thing that tells someone how much
 * work they lost.
 */
export type DatabaseRecovery = {
  reason: "primary-corrupt" | "primary-missing";
  backupModifiedAt: string | null;
  recoveredAt: string;
};

export type SettingsPayload = {
  defaultKindleEmail: string | null;
  smtp: SmtpSettings;
  /** Set only while an unacknowledged, user-visible recovery is on record. */
  databaseRecovery: DatabaseRecovery | null;
};

export type ImportResult =
  | {
      status: "imported";
      message: string;
      book: BookSummary;
    }
  | {
      status: "duplicate";
      message: string;
      book: BookSummary;
    }
  | {
      status: "failed";
      message: string;
      book?: undefined;
    };

export type DeleteBookResult = {
  id: string;
  title: string;
  message: string;
};

export type DeleteBookshelfResult = {
  id: string;
  name: string;
  message: string;
};
