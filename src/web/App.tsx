import type { CSSProperties, DragEvent, FormEvent, MouseEvent } from "react";
import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import type {
  BookDetail,
  BookReader,
  BookReaderSection,
  BookSummary,
  DeliveryRecord,
  ImportResult,
  SettingsPayload,
} from "../shared/types";
import { api } from "./lib/api";
import {
  createReaderAssetSection,
  getReaderDocumentTitle,
  renderReaderDocument,
  type ReaderLinkTarget,
} from "./lib/reader";

type Theme = "light" | "dark";
type BookshelfView = "grid" | "list";
type ReaderTone = "paper" | "sepia" | "night";

const THEME_KEY = "ebook-manager-theme";
const BOOKSHELF_VIEW_KEY = "ebook-manager-bookshelf-view";
const READER_TONE_KEY = "ebook-manager-reader-tone";
const READER_FONT_SCALE_KEY = "ebook-manager-reader-font-scale";
const READER_MIN_FONT_SCALE = 0.95;
const READER_MAX_FONT_SCALE = 1.25;
const READER_FONT_SCALE_STEP = 0.1;
const THEME_META_COLORS: Record<Theme, string> = {
  dark: "#0A0A0B",
  light: "#F8F9FA",
};

function getSystemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

function getStoredBookshelfView(): BookshelfView | null {
  try {
    const stored = localStorage.getItem(BOOKSHELF_VIEW_KEY);
    if (stored === "grid" || stored === "list") return stored;
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

function getStoredReaderTone(): ReaderTone | null {
  try {
    const stored = localStorage.getItem(READER_TONE_KEY);
    if (stored === "paper" || stored === "sepia" || stored === "night") return stored;
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

function getStoredReaderFontScale(): number | null {
  try {
    const stored = Number.parseFloat(localStorage.getItem(READER_FONT_SCALE_KEY) ?? "");
    if (
      Number.isFinite(stored) &&
      stored >= READER_MIN_FONT_SCALE &&
      stored <= READER_MAX_FONT_SCALE
    ) {
      return stored;
    }
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.classList.toggle("dark", theme === "dark");
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = THEME_META_COLORS[theme];
}

function resolveTheme(): Theme {
  return getStoredTheme() ?? getSystemTheme();
}

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "dark",
  toggle: () => {},
});

function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    [query],
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

function useTheme() {
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const [theme, setTheme] = useState<Theme>(resolveTheme);

  useEffect(() => {
    if (!getStoredTheme()) {
      setTheme(prefersDark ? "dark" : "light");
    }
  }, [prefersDark]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}

const numberFormatter = new Intl.NumberFormat(undefined);
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes}\u00A0B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}\u00A0KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}\u00A0MB`;
};

const formatDate = (value: string | null) => {
  if (!value) return "\u2014";
  return dateFormatter.format(new Date(value));
};

const isFileDrag = (dataTransfer: DataTransfer | null) =>
  Array.from(dataTransfer?.items ?? []).some((item) => item.kind === "file") ||
  Array.from(dataTransfer?.types ?? []).includes("Files");

const useDocumentTitle = (title: string) => {
  useEffect(() => {
    document.title = title;
  }, [title]);
};

const getStatusBadgeVariant = (
  status: DeliveryRecord["status"] | "configured" | "missing",
): "secondary" | "outline" | "destructive" => {
  if (status === "failed" || status === "missing") return "destructive";
  if (status === "pending") return "outline";
  return "secondary";
};

const BookIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 3h4.5a2 2 0 0 1 2 2v9a1.5 1.5 0 0 0-1.5-1.5H2V3Z" />
    <path d="M14 3H9.5a2 2 0 0 0-2 2v9A1.5 1.5 0 0 1 9 12.5H14V3Z" />
  </svg>
);

const SettingsIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    <path d="M6.7 2.2a.7.7 0 0 1 .7-.7h1.2a.7.7 0 0 1 .7.7l.2 1.1a4.7 4.7 0 0 1 1.1.7l1-.4a.7.7 0 0 1 .8.3l.6 1a.7.7 0 0 1-.1.9l-.9.8v1.2l.9.7a.7.7 0 0 1 .1 1l-.6 1a.7.7 0 0 1-.8.3l-1-.4a4.8 4.8 0 0 1-1.1.7l-.2 1a.7.7 0 0 1-.7.7H7.4a.7.7 0 0 1-.7-.6l-.2-1.1a4.7 4.7 0 0 1-1.1-.7l-1 .4a.7.7 0 0 1-.9-.3l-.6-1a.7.7 0 0 1 .2-.9l.8-.8V7.5l-.8-.7a.7.7 0 0 1-.2-1l.6-1a.7.7 0 0 1 .9-.3l1 .4a4.7 4.7 0 0 1 1-.7l.3-1Z" />
  </svg>
);

const ArrowLeftIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M10 12 6 8l4-4" />
  </svg>
);

const SunIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1M8 13.5v1M3.4 3.4l.7.7M11.9 11.9l.7.7M1.5 8h1M13.5 8h1M3.4 12.6l.7-.7M11.9 4.1l.7-.7" />
  </svg>
);

const MoonIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M13.4 10.3A5.5 5.5 0 0 1 5.7 2.6a5.5 5.5 0 1 0 7.7 7.7Z" />
  </svg>
);

const GridIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h4v4h-4z" />
  </svg>
);

const ListIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 4h10M3 8h10M3 12h10" />
    <path d="M1.5 4h.01M1.5 8h.01M1.5 12h.01" />
  </svg>
);

const UploadIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 16V5" />
    <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
    <path d="M5 19h14" />
  </svg>
);

const PlaceholderCover = ({ title }: { title: string }) => (
  <div className="book-cover-fallback" aria-hidden="true">
    <span>{title.trim().charAt(0).toUpperCase() || "B"}</span>
  </div>
);

const BookCover = ({ book, large = false }: { book: BookSummary; large?: boolean }) => (
  <div className={`book-cover ${large ? "book-cover-large" : ""}`}>
    {book.coverUrl ? (
      <img
        alt=""
        aria-hidden="true"
        className="book-cover-image"
        src={book.coverUrl}
        width={large ? 280 : 160}
        height={large ? 373 : 213}
        loading={large ? "eager" : "lazy"}
      />
    ) : (
      <PlaceholderCover title={book.title} />
    )}
  </div>
);

type ImportBooksModalProps = {
  open: boolean;
  onClose: () => void;
  onImportFiles: (files: File[]) => void;
};

const ImportBooksModal = ({ open, onClose, onImportFiles }: ImportBooksModalProps) => {
  const browseButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);

  const resetDropTarget = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDropTargetActive(false);
  }, []);

  useEffect(() => {
    if (!open) {
      resetDropTarget();
      return;
    }

    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    browseButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      resetDropTarget();
      previousActiveElement?.focus();
    };
  }, [open, resetDropTarget]);

  if (!open) return null;

  const submitFiles = (files: File[]) => {
    if (files.length === 0) return;

    onImportFiles(files);
    onClose();
  };

  const onDragEnterDropzone = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event.dataTransfer)) return;

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDropTargetActive(true);
  };

  const onDragOverDropzone = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event.dataTransfer)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";

    if (!isDropTargetActive) {
      setIsDropTargetActive(true);
    }
  };

  const onDragLeaveDropzone = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event.dataTransfer)) return;

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDropTargetActive(false);
    }
  };

  const onDropDropzone = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event.dataTransfer)) return;

    event.preventDefault();
    resetDropTarget();
    submitFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent
        className="import-modal gap-6 sm:max-w-[560px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          browseButtonRef.current?.focus();
        }}
        showCloseButton={false}
      >
        <div className="import-modal-header">
          <DialogHeader className="stack-xs import-modal-copy gap-1">
            <DialogTitle className="text-[20px] font-semibold tracking-[-0.02em]">
              Add EPUBs
            </DialogTitle>
          </DialogHeader>
          <Button className="import-modal-dismiss" onClick={onClose} type="button" variant="outline">
            Close
          </Button>
        </div>

        <div
          className={cn("import-dropzone", isDropTargetActive && "import-dropzone-active")}
          onDragEnter={onDragEnterDropzone}
          onDragLeave={onDragLeaveDropzone}
          onDragOver={onDragOverDropzone}
          onDrop={onDropDropzone}
        >
          <div className="import-dropzone-icon">
            <UploadIcon />
          </div>
          <p className="import-dropzone-title">
            {isDropTargetActive ? "Release to upload" : "Drag and Drop here"}
          </p>
          <p className="import-dropzone-divider">or</p>
          <Button onClick={() => fileInputRef.current?.click()} ref={browseButtonRef} size="lg" type="button">
            Browse files
          </Button>
          <input
            accept=".epub,application/epub+zip"
            aria-hidden="true"
            className="sr-only"
            multiple
            onChange={(event) => {
              submitFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
            ref={fileInputRef}
            tabIndex={-1}
            type="file"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

type DeleteBookModalProps = {
  open: boolean;
  deleting: boolean;
  error: string | null;
  bookTitle: string;
  onClose: () => void;
  onConfirm: () => void;
};

const DeleteBookModal = ({
  open,
  deleting,
  error,
  bookTitle,
  onClose,
  onConfirm,
}: DeleteBookModalProps) => (
  <AlertDialog
    onOpenChange={(nextOpen) => {
      if (!deleting && !nextOpen) {
        onClose();
      }
    }}
    open={open}
  >
    <AlertDialogContent
      className="confirm-modal gap-6 sm:max-w-[460px]"
      onEscapeKeyDown={(event) => {
        if (deleting) {
          event.preventDefault();
        }
      }}
    >
      <div className="stack-sm">
        <div className="stack-xs">
          <p className="eyebrow">Delete book</p>
          <AlertDialogTitle className="text-left text-[20px] font-semibold tracking-[-0.02em]">
            Remove this title from your library?
          </AlertDialogTitle>
        </div>
        <AlertDialogDescription className="confirm-modal-copy text-left">
          <strong className="font-semibold text-[var(--text-primary)]">{bookTitle}</strong> and its
          delivery history will be removed. This cannot be undone.
        </AlertDialogDescription>
      </div>

      {error ? (
        <p aria-live="polite" className="inline-error">
          {error}
        </p>
      ) : null}

      <div className="confirm-modal-actions">
        <AlertDialogCancel disabled={deleting} onClick={onClose}>
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction
          disabled={deleting}
          onClick={(event) => {
            event.preventDefault();
            if (!deleting) {
              onConfirm();
            }
          }}
          variant="destructive"
        >
          {deleting ? "Deleting\u2026" : "Delete book"}
        </AlertDialogAction>
      </div>
    </AlertDialogContent>
  </AlertDialog>
);

const UploadResults = ({ results }: { results: ImportResult[] }) => {
  if (results.length === 0) return null;

  return (
    <Card aria-live="polite">
      <CardHeader className="section-heading border-b">
        <CardTitle>Import results</CardTitle>
        <span>{numberFormatter.format(results.length)} file(s)</span>
      </CardHeader>
      <CardContent>
        <ul className="result-list">
          {results.map((result, index) => (
            <li
              className={`result-item result-${result.status}`}
              key={`${result.status}-${index}-${result.message}`}
            >
              <strong>{result.status}</strong>
              <span>{result.message}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};

const SkeletonLine = ({ className = "" }: { className?: string }) => (
  <Skeleton aria-hidden="true" className={`skeleton-line${className ? ` ${className}` : ""}`} />
);

const BookshelfSkeleton = ({ view }: { view: BookshelfView }) => {
  if (view === "list") {
    return (
      <section aria-hidden="true" className="books-list books-list-skeleton">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="book-list-row skeleton-card" key={`bookshelf-list-skeleton-${index}`}>
            <div className="book-list-cover">
              <div className="book-cover">
                <div className="skeleton-block skeleton-cover" />
              </div>
            </div>
            <div className="book-list-primary stack-xs">
              <SkeletonLine className="skeleton-line-title" />
              <SkeletonLine className="skeleton-line-medium" />
            </div>
            <div className="book-list-detail stack-xs">
              <SkeletonLine className="skeleton-line-small" />
              <SkeletonLine className="skeleton-line-medium" />
            </div>
            <div className="book-list-detail stack-xs">
              <SkeletonLine className="skeleton-line-small" />
              <SkeletonLine className="skeleton-line-medium" />
            </div>
            <div className="book-list-detail stack-xs">
              <SkeletonLine className="skeleton-line-small" />
              <SkeletonLine className="skeleton-line-small" />
            </div>
          </div>
        ))}
      </section>
    );
  }

  return (
    <section aria-hidden="true" className="books-grid books-grid-skeleton">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="book-card skeleton-card" key={`bookshelf-grid-skeleton-${index}`}>
          <div className="book-cover">
            <div className="skeleton-block skeleton-cover" />
          </div>
          <div className="book-card-copy stack-xs">
            <SkeletonLine className="skeleton-line-title" />
            <SkeletonLine className="skeleton-line-medium" />
            <SkeletonLine className="skeleton-line-small" />
          </div>
        </div>
      ))}
    </section>
  );
};

const BookshelfGrid = ({ books }: { books: BookSummary[] }) => (
  <section aria-label="Bookshelf grid" className="books-grid">
    {books.map((book) => (
      <Link className="book-card" key={book.id} to={`/books/${book.id}`}>
        <BookCover book={book} />
        <div className="book-card-copy stack-xs">
          <strong className="book-title">{book.title}</strong>
          <span className="book-author">{book.author}</span>
          <span className="book-meta">{formatBytes(book.fileSizeBytes)}</span>
        </div>
      </Link>
    ))}
  </section>
);

const BookshelfList = ({ books }: { books: BookSummary[] }) => (
  <section aria-label="Bookshelf list" className="books-list">
    {books.map((book) => (
      <Link className="book-list-row" key={book.id} to={`/books/${book.id}`}>
        <div className="book-list-cover">
          <BookCover book={book} />
        </div>
        <div className="book-list-primary">
          <strong className="book-title">{book.title}</strong>
          <span className="book-author">{book.author}</span>
        </div>
        <div className="book-list-detail">
          <span className="book-list-label">File</span>
          <span className="book-list-value" title={book.sourceFilename}>
            {book.sourceFilename}
          </span>
        </div>
        <div className="book-list-detail">
          <span className="book-list-label">Imported</span>
          <span className="book-list-value">{formatDate(book.importedAt)}</span>
        </div>
        <div className="book-list-detail book-list-detail-compact">
          <span className="book-list-label">Size</span>
          <span className="book-list-value">{formatBytes(book.fileSizeBytes)}</span>
        </div>
      </Link>
    ))}
  </section>
);

const BookDetailSkeleton = () => (
  <div aria-busy="true" className="page stack-lg">
    <Link className="backlink" to="/">
      <ArrowLeftIcon />
      Back to shelf
    </Link>

    <section aria-hidden="true" className="panel detail-layout">
      <div className="book-cover book-cover-large">
        <div className="skeleton-block skeleton-cover" />
      </div>
      <div className="stack-md">
        <div className="stack-xs">
          <SkeletonLine className="skeleton-line-small" />
          <SkeletonLine className="skeleton-line-heading" />
          <SkeletonLine className="skeleton-line-medium" />
        </div>

        <div className="metadata-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={`book-detail-meta-skeleton-${index}`}>
              <SkeletonLine className="skeleton-line-small" />
              <SkeletonLine className="skeleton-line-medium" />
            </div>
          ))}
        </div>

        <div className="stack-sm">
          <div className="stack-xs">
            <SkeletonLine className="skeleton-line-label" />
            <div className="skeleton-input" />
          </div>
          <div className="inline-actions" aria-hidden="true">
            <div className="skeleton-button" />
            <div className="skeleton-button skeleton-button-secondary" />
          </div>
        </div>
      </div>
    </section>

    <section aria-hidden="true" className="panel stack-sm">
      <div className="section-heading">
        <SkeletonLine className="skeleton-line-section" />
        <SkeletonLine className="skeleton-line-small" />
      </div>
      <div className="stack-xs">
        {Array.from({ length: 3 }, (_, index) => (
          <div className="skeleton-row" key={`delivery-history-skeleton-${index}`} />
        ))}
      </div>
    </section>
  </div>
);

const SettingsSkeleton = () => (
  <div aria-busy="true" className="page stack-lg">
    <section aria-hidden="true" className="panel stack-md">
      <div className="stack-xs">
        <SkeletonLine className="skeleton-line-heading" />
        <SkeletonLine className="skeleton-line-paragraph" />
        <SkeletonLine className="skeleton-line-medium" />
      </div>

      <div className="stack-sm">
        <div className="stack-xs">
          <SkeletonLine className="skeleton-line-label" />
          <div className="skeleton-input" />
        </div>
        <div className="inline-actions" aria-hidden="true">
          <div className="skeleton-button" />
          <div className="skeleton-button skeleton-button-secondary" />
        </div>
      </div>
    </section>
  </div>
);

const Shell = () => {
  const location = useLocation();
  const { theme, toggle } = useContext(ThemeContext);

  const pageTitle = (() => {
    if (location.pathname === "/settings") return "Settings";
    if (location.pathname.startsWith("/books/") && location.pathname.endsWith("/read")) {
      return "Reader";
    }
    if (location.pathname.startsWith("/books/")) return "Book detail";
    return "Bookshelf";
  })();

  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="sidebar-brand-icon">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 3h4.5a2 2 0 0 1 2 2v9a1.5 1.5 0 0 0-1.5-1.5H2V3Z" />
                <path d="M14 3H9.5a2 2 0 0 0-2 2v9A1.5 1.5 0 0 1 9 12.5H14V3Z" />
              </svg>
            </div>
            <h1>ebooks</h1>
          </div>
          <nav aria-label="Primary">
            <NavLink
              className={({ isActive }) => (isActive ? "navlink active" : "navlink")}
              to="/"
              end
            >
              <BookIcon />
              Bookshelf
            </NavLink>
            <NavLink
              className={({ isActive }) => (isActive ? "navlink active" : "navlink")}
              to="/settings"
            >
              <SettingsIcon />
              Settings
            </NavLink>
          </nav>
          <div className="sidebar-footer">
            <Button
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              className="theme-toggle"
              onClick={toggle}
              type="button"
              variant="ghost"
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </Button>
          </div>
        </aside>
        <div className="main-area">
          <header className="main-header">
            <h2 className="main-header-title">{pageTitle}</h2>
          </header>
          <main className="content" id="content">
            <Outlet />
          </main>
        </div>
      </div>
    </>
  );
};

const BookshelfPage = () => {
  useDocumentTitle("Bookshelf \u2022 Irulan");

  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [view, setView] = useState<BookshelfView>(() => getStoredBookshelfView() ?? "grid");
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [lastLoadedQuery, setLastLoadedQuery] = useState(searchParams.get("q") ?? "");
  const [results, setResults] = useState<ImportResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [hasLoadedBooks, setHasLoadedBooks] = useState(false);
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const latestBooksRequest = useRef(0);
  const flashMessage = (location.state as { message?: string } | null)?.message ?? null;

  const deferredQuery = useDeferredValue(query);

  const loadBooks = useEffectEvent(async (term: string) => {
    const requestId = latestBooksRequest.current + 1;
    latestBooksRequest.current = requestId;

    if (!hasLoadedBooks) {
      setLoading(true);
    }
    setError(null);

    try {
      const [nextBooks, nextSettings] = await Promise.all([
        api.listBooks(term),
        hasLoadedSettings ? Promise.resolve<SettingsPayload | null>(null) : api.getSettings(),
      ]);

      if (requestId !== latestBooksRequest.current) {
        return;
      }

      setBooks(nextBooks);
      setLastLoadedQuery(term);

      if (nextSettings) {
        setSettings(nextSettings);
        setHasLoadedSettings(true);
      }
    } catch (requestError) {
      if (requestId !== latestBooksRequest.current) {
        return;
      }

      setError(requestError instanceof Error ? requestError.message : "Could not load books.");
    } finally {
      if (requestId === latestBooksRequest.current) {
        setLoading(false);
        setHasLoadedBooks(true);
      }
    }
  });

  useEffect(() => {
    void loadBooks(deferredQuery);
  }, [deferredQuery]);

  useEffect(() => {
    const nextQuery = searchParams.get("q") ?? "";
    setQuery((current) => (current === nextQuery ? current : nextQuery));
  }, [searchParams]);

  const onChangeView = useCallback((nextView: BookshelfView) => {
    setView(nextView);
    try {
      localStorage.setItem(BOOKSHELF_VIEW_KEY, nextView);
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const importFiles = useEffectEvent(async (files: File[]) => {
    if (files.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      const nextResults = await api.importBooks(files);
      setResults(nextResults);
      await loadBooks(deferredQuery);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Import failed.");
    } finally {
      setUploading(false);
    }
  });

  const showInitialBookshelfSkeleton = loading && !hasLoadedBooks;
  const showingFilteredResults = lastLoadedQuery.trim().length > 0;

  return (
    <div className="page stack-lg">
      <section className="hero-panel">
        <div className="hero-copy">
          <h2>Your bookshelf</h2>
        </div>
        <div className="hero-actions">
          <Button disabled={uploading} onClick={() => setIsImportModalOpen(true)} type="button">
            {uploading ? "Importing\u2026" : "Add EPUBs"}
          </Button>
          {!settings?.defaultKindleEmail && (
            <Button asChild variant="outline">
              <Link to="/settings">Add Kindle address</Link>
            </Button>
          )}
        </div>
      </section>

      <ImportBooksModal
        onClose={() => setIsImportModalOpen(false)}
        onImportFiles={(files) => {
          void importFiles(files);
        }}
        open={isImportModalOpen}
      />

      <section className="toolbar">
        <div className="searchbox">
          <Input
            aria-label="Search library"
            autoComplete="off"
            id="library-search"
            inputMode="search"
            name="library_search"
            onChange={(event) => {
              const nextValue = event.currentTarget.value;
              setQuery(nextValue);
              startTransition(() => {
                setSearchParams(nextValue ? { q: nextValue } : {});
              });
            }}
            placeholder={"Search by title, author\u2026"}
            type="search"
            value={query}
          />
        </div>
        <div className="toolbar-actions">
          <div aria-label="Bookshelf view" className="view-toggle" role="group">
            <Button
              aria-pressed={view === "grid"}
              className={cn("view-toggle-button", view === "grid" && "active")}
              onClick={() => onChangeView("grid")}
              size="sm"
              type="button"
              variant="ghost"
            >
              <GridIcon />
              Grid
            </Button>
            <Button
              aria-pressed={view === "list"}
              className={cn("view-toggle-button", view === "list" && "active")}
              onClick={() => onChangeView("list")}
              size="sm"
              type="button"
              variant="ghost"
            >
              <ListIcon />
              List
            </Button>
          </div>
          <div className="stat-chip">
            <strong>{numberFormatter.format(books.length)}</strong>
            <span>books</span>
          </div>
        </div>
      </section>

      {flashMessage ? <p className="inline-success">{flashMessage}</p> : null}
      {error ? <p className="inline-error">{error}</p> : null}
      <UploadResults results={results} />

      {showInitialBookshelfSkeleton ? (
        <BookshelfSkeleton view={view} />
      ) : books.length === 0 ? (
        <section className="empty-state stack-sm">
          <h2>{showingFilteredResults ? "No matching books" : "No books yet"}</h2>
          <p>
            {showingFilteredResults
              ? "Try a different title or author."
              : "Import EPUB files to populate your shelf."}
          </p>
        </section>
      ) : (
        view === "list" ? <BookshelfList books={books} /> : <BookshelfGrid books={books} />
      )}
    </div>
  );
};

const BookDetailPage = () => {
  const { bookId = "" } = useParams();
  const navigate = useNavigate();
  useDocumentTitle("Book detail \u2022 Irulan");

  const [book, setBook] = useState<BookDetail | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadBook = useEffectEvent(async () => {
    setLoading(true);
    setError(null);

    try {
      const [nextBook, nextDeliveries, nextSettings] = await Promise.all([
        api.getBook(bookId),
        api.getDeliveries(bookId),
        api.getSettings(),
      ]);

      setBook(nextBook);
      setDeliveries(nextDeliveries);
      setSettings(nextSettings);
      setRecipientEmail((current) => current || nextSettings.defaultKindleEmail || "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load the book.");
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    setBook(null);
    setDeliveries([]);
    setSettings(null);
    setMessage(null);
    setRecipientEmail("");
    setDeleteError(null);
    setIsDeleteModalOpen(false);
    void loadBook();
  }, [bookId]);

  const onSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    setMessage(null);

    try {
      const delivery = await api.sendBook(bookId, recipientEmail);
      setDeliveries((current) => [delivery, ...current]);
      setMessage(
        "Email accepted by SMTP. Amazon may still reject it if the sender is not approved.",
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Send failed.");
    } finally {
      setSending(false);
    }
  };

  const onDelete = async () => {
    if (!book) return;

    setDeleting(true);
    setDeleteError(null);

    try {
      const deletion = await api.deleteBook(book.id);
      setIsDeleteModalOpen(false);
      navigate("/", {
        replace: true,
        state: { message: deletion.message },
      });
    } catch (requestError) {
      setDeleteError(requestError instanceof Error ? requestError.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !book) {
    return <BookDetailSkeleton />;
  }

  if (!book) {
    return (
      <section className="empty-state stack-sm">
        <h2>Book unavailable</h2>
        <p>{error ?? "This record could not be loaded."}</p>
      </section>
    );
  }

  return (
    <div className="page stack-lg">
      <DeleteBookModal
        bookTitle={book.title}
        deleting={deleting}
        error={deleteError}
        onClose={() => {
          if (!deleting) {
            setDeleteError(null);
            setIsDeleteModalOpen(false);
          }
        }}
        onConfirm={() => {
          void onDelete();
        }}
        open={isDeleteModalOpen}
      />

      <Button asChild className="backlink" variant="ghost">
        <Link to="/">
          <ArrowLeftIcon />
          Back to shelf
        </Link>
      </Button>

      <Card className="panel detail-layout">
        <BookCover book={book} large />
        <div className="stack-md">
          <div className="stack-xs">
            <h2>{book.title}</h2>
            <p className="detail-author">{book.author}</p>
          </div>

          <dl className="metadata-grid">
            <div>
              <dt>Filename</dt>
              <dd>{book.sourceFilename}</dd>
            </div>
            <div>
              <dt>Imported</dt>
              <dd>{formatDate(book.importedAt)}</dd>
            </div>
            <div>
              <dt>File size</dt>
              <dd>{formatBytes(book.fileSizeBytes)}</dd>
            </div>
          </dl>

          <form className="stack-sm" onSubmit={onSend}>
            <div className="stack-xs">
              <Label className="field-label" htmlFor="recipient-email">
                Kindle address
              </Label>
              <Input
                autoComplete="email"
                id="recipient-email"
                name="recipient_email"
                onChange={(event) => setRecipientEmail(event.currentTarget.value)}
                placeholder="yourname@kindle.com"
                spellCheck={false}
                type="email"
                value={recipientEmail}
              />
            </div>
            <div className="inline-actions">
              <Button asChild variant="outline">
                <Link to={`/books/${book.id}/read`}>Read in browser</Link>
              </Button>
              <Button disabled={sending} type="submit">
                {sending ? "Sending\u2026" : "Send to Kindle"}
              </Button>
              <Button asChild variant="outline">
                <Link to="/settings">Delivery settings</Link>
              </Button>
            </div>
            {message ? (
              <p aria-live="polite" className="inline-success">
                {message}
              </p>
            ) : null}
            {error ? <p className="inline-error">{error}</p> : null}
          </form>

          <div className="detail-danger-zone stack-sm">
            <div className="stack-xs">
              <p className="eyebrow">Library</p>
              <p className="detail-danger-copy">
                Remove this EPUB and its delivery history from your library.
              </p>
            </div>
            <div className="inline-actions">
              <Button
                disabled={deleting || sending}
                onClick={() => {
                  setDeleteError(null);
                  setIsDeleteModalOpen(true);
                }}
                type="button"
                variant="destructive"
              >
                Delete book
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="panel stack-sm">
        <CardHeader className="section-heading border-b">
          <CardTitle>Delivery history</CardTitle>
          <span>{numberFormatter.format(deliveries.length)} attempts</span>
        </CardHeader>
        {deliveries.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)", fontSize: 13 }}>No sends yet.</p>
        ) : (
          <Table className="history-table">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Recipient</TableHead>
                <TableHead scope="col">Created</TableHead>
                <TableHead scope="col">Sent</TableHead>
                <TableHead scope="col">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>
                    <Badge
                      className={cn("status-pill", `status-${delivery.status}`)}
                      variant={getStatusBadgeVariant(delivery.status)}
                    >
                      {delivery.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{delivery.recipientEmail}</TableCell>
                  <TableCell>{formatDate(delivery.createdAt)}</TableCell>
                  <TableCell>{formatDate(delivery.sentAt)}</TableCell>
                  <TableCell>{delivery.errorMessage ?? "\u2014"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
};

const ReaderPage = () => {
  const { bookId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const readerBodyRef = useRef<HTMLElement | null>(null);
  const sectionMarkupCache = useRef(new Map<string, string>());
  const latestSectionRequest = useRef(0);

  const [reader, setReader] = useState<BookReader | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectionDocument, setSectionDocument] = useState<Document | null>(null);
  const [sectionTitle, setSectionTitle] = useState<string | null>(null);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [tone, setTone] = useState<ReaderTone>(() => getStoredReaderTone() ?? "paper");
  const [fontScale, setFontScale] = useState(() => getStoredReaderFontScale() ?? 1);

  const selectedHref = searchParams.get("section")?.trim() ?? "";
  const anchorId = searchParams.get("anchor")?.trim() ?? null;
  const activeSection = (() => {
    if (!reader) return null;
    if (!selectedHref) return reader.sections[0] ?? null;

    return (
      reader.sections.find((section) => section.href === selectedHref) ??
      createReaderAssetSection(bookId, selectedHref)
    );
  })();
  const currentSectionIndex =
    reader && activeSection
      ? reader.sections.findIndex((section) => section.href === activeSection.href)
      : -1;
  const previousSection =
    reader && currentSectionIndex > 0 ? reader.sections[currentSectionIndex - 1] : null;
  const nextSection =
    reader && currentSectionIndex >= 0 && currentSectionIndex < reader.sections.length - 1
      ? reader.sections[currentSectionIndex + 1]
      : null;
  const activeSectionLabel = sectionTitle ?? activeSection?.label ?? reader?.title ?? "Reader";
  const readerStyle = {
    "--reader-font-scale": `${fontScale}`,
  } as CSSProperties;

  useDocumentTitle(
    reader
      ? `${activeSectionLabel} \u2022 ${reader.title} \u2022 Irulan`
      : "Reader \u2022 Irulan",
  );

  useEffect(() => {
    try {
      localStorage.setItem(READER_TONE_KEY, tone);
    } catch {
      /* noop */
    }
  }, [tone]);

  useEffect(() => {
    try {
      localStorage.setItem(READER_FONT_SCALE_KEY, String(fontScale));
    } catch {
      /* noop */
    }
  }, [fontScale]);

  const goToSection = useCallback(
    (
      href: string,
      options: {
        anchor?: string | null;
        replace?: boolean;
      } = {},
    ) => {
      if (!href) return;

      const params = new URLSearchParams();
      params.set("section", href);

      if (options.anchor) {
        params.set("anchor", options.anchor);
      }

      startTransition(() => {
        setSearchParams(params, { replace: options.replace });
      });
    },
    [setSearchParams],
  );

  const loadReader = useEffectEvent(async () => {
    setLoading(true);
    setError(null);

    try {
      setReader(await api.getBookReader(bookId));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load this EPUB.");
    } finally {
      setLoading(false);
    }
  });

  const loadSection = useEffectEvent(async (section: BookReaderSection) => {
    const requestId = latestSectionRequest.current + 1;
    latestSectionRequest.current = requestId;

    setSectionLoading(true);
    setSectionError(null);

    try {
      let markup = sectionMarkupCache.current.get(section.href) ?? null;

      if (!markup) {
        const response = await fetch(section.url, {
          headers: {
            Accept: "application/xhtml+xml, text/html;q=0.9",
          },
        });

        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}.`);
        }

        markup = await response.text();
        sectionMarkupCache.current.set(section.href, markup);
      }

      let nextDocument = new DOMParser().parseFromString(markup, "application/xhtml+xml");
      if (nextDocument.querySelector("parsererror")) {
        nextDocument = new DOMParser().parseFromString(markup, "text/html");
      }

      if (requestId !== latestSectionRequest.current) {
        return;
      }

      setSectionDocument(nextDocument);
      setSectionTitle(getReaderDocumentTitle(nextDocument));
    } catch (requestError) {
      if (requestId !== latestSectionRequest.current) {
        return;
      }

      setSectionDocument(null);
      setSectionTitle(null);
      setSectionError(
        requestError instanceof Error ? requestError.message : "Could not load this section.",
      );
    } finally {
      if (requestId === latestSectionRequest.current) {
        setSectionLoading(false);
      }
    }
  });

  useEffect(() => {
    sectionMarkupCache.current.clear();
    setReader(null);
    setError(null);
    setSectionDocument(null);
    setSectionTitle(null);
    setSectionError(null);
    void loadReader();
  }, [bookId]);

  useEffect(() => {
    if (!reader || reader.sections.length === 0 || selectedHref) {
      return;
    }

    goToSection(reader.sections[0]?.href ?? "", { replace: true });
  }, [goToSection, reader, selectedHref]);

  useEffect(() => {
    setSectionDocument(null);
    setSectionTitle(null);
    setSectionError(null);

    if (!activeSection) {
      setSectionLoading(false);
      return;
    }

    void loadSection(activeSection);
  }, [activeSection?.href, activeSection?.url]);

  useEffect(() => {
    if (sectionLoading) {
      return;
    }

    const root = readerBodyRef.current;
    if (!root) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      if (anchorId) {
        const escapedId =
          typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(anchorId)
            : anchorId.replace(/[^\w-]/g, "\\$&");
        const escapedName = anchorId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const anchorTarget = root.querySelector<HTMLElement>(
          `#${escapedId}, [name="${escapedName}"]`,
        );

        if (anchorTarget) {
          anchorTarget.scrollIntoView({ block: "start" });
          return;
        }
      }

      window.scrollTo({ top: 0, behavior: "auto" });
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [anchorId, activeSection?.href, sectionDocument, sectionLoading]);

  const onInternalReaderLinkClick = useCallback(
    (
      event: MouseEvent<HTMLAnchorElement>,
      target: Extract<ReaderLinkTarget, { kind: "internal" }>,
    ) => {
      event.preventDefault();
      goToSection(target.href, {
        anchor: target.anchor,
        replace: target.href === activeSection?.href,
      });
    },
    [activeSection?.href, goToSection],
  );

  const onAdjustFontScale = useCallback((delta: number) => {
    setFontScale((current) => {
      const next = Number((current + delta).toFixed(2));
      return Math.max(READER_MIN_FONT_SCALE, Math.min(READER_MAX_FONT_SCALE, next));
    });
  }, []);

  if (loading && !reader) {
    return (
      <div className="page stack-lg">
        <Button asChild className="backlink" variant="ghost">
          <Link to={`/books/${bookId}`}>
            <ArrowLeftIcon />
            Back to book
          </Link>
        </Button>

        <section aria-busy="true" className="reader-shell">
          <aside aria-hidden="true" className="panel reader-sidebar stack-sm">
            <div className="stack-xs">
              <SkeletonLine className="skeleton-line-small" />
              <SkeletonLine className="skeleton-line-heading" />
              <SkeletonLine className="skeleton-line-medium" />
            </div>
            <div className="skeleton-input" />
            <div className="stack-xs">
              {Array.from({ length: 6 }, (_, index) => (
                <div className="skeleton-button" key={`reader-skeleton-nav-${index}`} />
              ))}
            </div>
          </aside>
          <section aria-hidden="true" className="reader-content stack-sm">
            <div className="reader-toolbar">
              <div className="skeleton-button skeleton-button-secondary" />
              <SkeletonLine className="skeleton-line-medium" />
              <div className="skeleton-button skeleton-button-secondary" />
            </div>
            <div className="reader-canvas">
              <div className="reader-paper">
                <div className="stack-sm">
                  {Array.from({ length: 8 }, (_, index) => (
                    <SkeletonLine
                      className={index === 0 ? "skeleton-line-heading" : "skeleton-line-paragraph"}
                      key={`reader-paper-skeleton-${index}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>
        </section>
      </div>
    );
  }

  if (!reader) {
    return (
      <div className="page stack-lg">
        <Button asChild className="backlink" variant="ghost">
          <Link to={`/books/${bookId}`}>
            <ArrowLeftIcon />
            Back to book
          </Link>
        </Button>

        <section className="empty-state stack-sm">
          <h2>Reader unavailable</h2>
          <p>{error ?? "This EPUB could not be opened in the browser."}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page stack-lg">
      <Button asChild className="backlink" variant="ghost">
        <Link to={`/books/${bookId}`}>
          <ArrowLeftIcon />
          Back to book
        </Link>
      </Button>

      {error ? <p className="inline-error">{error}</p> : null}

      <section className="reader-shell">
        <Card className="panel reader-sidebar stack-sm">
          <div className="stack-xs">
            <p className="eyebrow">Now reading</p>
            <h2>{reader.title}</h2>
            <p className="detail-author">{reader.author}</p>
          </div>

          {currentSectionIndex >= 0 ? (
            <div className="stat-chip reader-progress">
              <strong>{numberFormatter.format(currentSectionIndex + 1)}</strong>
              <span>of {numberFormatter.format(reader.sections.length)} sections</span>
            </div>
          ) : (
            <div className="stat-chip reader-progress">
              <strong>Linked</strong>
              <span>section</span>
            </div>
          )}

          <div className="stack-xs">
            <Label className="field-label" htmlFor="reader-section">
              Jump to section
            </Label>
            <Select onValueChange={goToSection} value={activeSection?.href ?? ""}>
              <SelectTrigger className="w-full" id="reader-section">
                <SelectValue placeholder="Choose a section" />
              </SelectTrigger>
              <SelectContent>
                {reader.sections.map((section, index) => (
                  <SelectItem key={section.id} value={section.href}>
                    {index + 1}. {section.label}
                  </SelectItem>
                ))}
                {currentSectionIndex < 0 && activeSection ? (
                  <SelectItem value={activeSection.href}>{activeSection.label}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>

          <nav aria-label="Table of contents" className="reader-toc">
            {reader.sections.map((section, index) => (
              <Button
                aria-current={section.href === activeSection?.href ? "page" : undefined}
                className={cn(
                  "reader-toc-item",
                  section.href === activeSection?.href && "active",
                )}
                key={section.id}
                onClick={() => goToSection(section.href)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <span className="reader-toc-index">{index + 1}</span>
                <span className="reader-toc-label">{section.label}</span>
              </Button>
            ))}
          </nav>
        </Card>

        <section className="reader-content">
          <div className="reader-toolbar">
            <div className="reader-toolbar-nav">
              <Button
                disabled={!previousSection}
                onClick={() =>
                  previousSection ? goToSection(previousSection.href) : undefined
                }
                type="button"
                variant="outline"
              >
                Previous
              </Button>
              <Button
                disabled={!nextSection}
                onClick={() => (nextSection ? goToSection(nextSection.href) : undefined)}
                type="button"
                variant="outline"
              >
                Next
              </Button>
            </div>

            <strong className="reader-current-label">{activeSectionLabel}</strong>

            <div className="reader-toolbar-controls">
              <div aria-label="Reader tone" className="view-toggle" role="group">
                {(["paper", "sepia", "night"] as const).map((option) => (
                  <Button
                    aria-pressed={tone === option}
                    className={cn("view-toggle-button", tone === option && "active")}
                    key={option}
                    onClick={() => setTone(option)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {option === "paper"
                      ? "Paper"
                      : option === "sepia"
                        ? "Sepia"
                        : "Night"}
                  </Button>
                ))}
              </div>

              <div aria-label="Type size" className="view-toggle" role="group">
                <Button
                  aria-label="Decrease type size"
                  className="view-toggle-button"
                  disabled={fontScale <= READER_MIN_FONT_SCALE}
                  onClick={() => onAdjustFontScale(-READER_FONT_SCALE_STEP)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  A-
                </Button>
                <div className="stat-chip reader-type-scale">
                  <strong>{Math.round(fontScale * 100)}%</strong>
                </div>
                <Button
                  aria-label="Increase type size"
                  className="view-toggle-button"
                  disabled={fontScale >= READER_MAX_FONT_SCALE}
                  onClick={() => onAdjustFontScale(READER_FONT_SCALE_STEP)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  A+
                </Button>
              </div>
            </div>
          </div>

          <div className="reader-canvas" data-reader-tone={tone} style={readerStyle}>
            <div className="reader-paper">
              <header className="reader-paper-header">
                <p className="eyebrow">Section</p>
                <h2>{activeSectionLabel}</h2>
              </header>

              {sectionError ? <p className="inline-error">{sectionError}</p> : null}

              {sectionLoading && !sectionDocument ? (
                <div aria-hidden="true" className="reader-loading stack-sm">
                  {Array.from({ length: 9 }, (_, index) => (
                    <SkeletonLine
                      className={index === 0 ? "skeleton-line-heading" : "skeleton-line-paragraph"}
                      key={`reader-body-skeleton-${index}`}
                    />
                  ))}
                </div>
              ) : activeSection && sectionDocument ? (
                <article className="reader-body" ref={readerBodyRef}>
                  {renderReaderDocument({
                    bookId,
                    document: sectionDocument,
                    onInternalLinkClick: onInternalReaderLinkClick,
                    section: activeSection,
                  })}
                </article>
              ) : (
                <div className="empty-state stack-sm">
                  <h2>No readable sections</h2>
                  <p>This EPUB does not include any linear spine items to display.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      </section>
    </div>
  );
};

const SettingsPage = () => {
  useDocumentTitle("Settings \u2022 Irulan");

  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [defaultEmail, setDefaultEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useEffectEvent(async () => {
    setLoading(true);
    setError(null);

    try {
      const payload = await api.getSettings();
      setSettings(payload);
      setDefaultEmail(payload.defaultKindleEmail ?? "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void loadSettings();
  }, []);

  const onSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const payload = await api.saveSettings(defaultEmail.trim() || null);
      setSettings(payload);
      setMessage("Default Kindle address saved.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const onSendTest = async () => {
    setTesting(true);
    setError(null);
    setMessage(null);

    try {
      await api.sendTestEmail(defaultEmail.trim());
      setMessage("SMTP test email sent.");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not send the test email.",
      );
    } finally {
      setTesting(false);
    }
  };

  if (loading && !settings) {
    return <SettingsSkeleton />;
  }

  return (
    <div className="page stack-lg">
      <Card className="panel stack-md">
        <div className="stack-xs">
          <h2>Kindle destination</h2>
          <p className="lede">
            Set a default Kindle email. SMTP credentials are read from <code>.env</code>.
          </p>
        </div>

        <form className="stack-sm" onSubmit={onSave}>
          <div className="stack-xs">
            <Label className="field-label" htmlFor="default-kindle-email">
              Default Kindle email
            </Label>
            <Input
              autoComplete="email"
              id="default-kindle-email"
              name="default_kindle_email"
              onChange={(event) => setDefaultEmail(event.currentTarget.value)}
              placeholder="yourname@kindle.com"
              spellCheck={false}
              type="email"
              value={defaultEmail}
            />
          </div>
          <div className="inline-actions">
            <Button disabled={saving} type="submit">
              {saving ? "Saving\u2026" : "Save"}
            </Button>
            <Button
              disabled={testing || !defaultEmail.trim()}
              onClick={onSendTest}
              type="button"
              variant="outline"
            >
              {testing ? "Sending\u2026" : "Send test email"}
            </Button>
          </div>
          {message ? (
            <p aria-live="polite" className="inline-success">
              {message}
            </p>
          ) : null}
          {error ? <p className="inline-error">{error}</p> : null}
        </form>
      </Card>

      <Card className="panel stack-sm">
        <CardHeader className="section-heading border-b">
          <CardTitle>SMTP status</CardTitle>
          <Badge
            className={cn(
              "status-pill",
              settings?.smtpConfigured ? "status-sent" : "status-failed",
            )}
            variant={getStatusBadgeVariant(settings?.smtpConfigured ? "configured" : "missing")}
          >
            {settings?.smtpConfigured ? "Configured" : "Missing"}
          </Badge>
        </CardHeader>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: 0 }}>
          Sender: <strong>{settings?.smtpFrom ?? "Not set"}</strong>
        </p>
        <p style={{ color: "var(--text-tertiary)", fontSize: 13, margin: 0 }}>
          Amazon requires the sender email on your approved personal document sender list.
          SMTP success does not guarantee Kindle acceptance.
        </p>
        <pre className="env-snippet">
{`SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=sender@example.com
SMTP_PASS=replace-me
SMTP_FROM=sender@example.com`}
        </pre>
      </Card>
    </div>
  );
};

const AppRoutes = () => (
  <Routes>
    <Route element={<Shell />}>
      <Route element={<BookshelfPage />} path="/" />
      <Route element={<BookDetailPage />} path="/books/:bookId" />
      <Route element={<ReaderPage />} path="/books/:bookId/read" />
      <Route element={<SettingsPage />} path="/settings" />
    </Route>
  </Routes>
);

export default function App() {
  const themeValue = useTheme();

  return (
    <ThemeContext.Provider value={themeValue}>
      <AppRoutes />
    </ThemeContext.Provider>
  );
}
