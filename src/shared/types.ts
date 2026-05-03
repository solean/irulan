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
  bookshelves: BookshelfSummary[];
};

export type BookDetail = BookSummary;

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

export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  configured: boolean;
  source: "app" | "environment";
};

export type SettingsPayload = {
  defaultKindleEmail: string | null;
  smtp: SmtpSettings;
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
