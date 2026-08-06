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
