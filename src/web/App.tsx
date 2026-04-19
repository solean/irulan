import type { CSSProperties, DragEvent, FormEvent, KeyboardEvent, MouseEvent } from "react";
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
import { createPortal } from "react-dom";
import {
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";

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

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const getFocusableElements = (container: HTMLElement | null) =>
  container
    ? Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    : [];

const useDocumentTitle = (title: string) => {
  useEffect(() => {
    document.title = title;
  }, [title]);
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
  const modalRef = useRef<HTMLDivElement | null>(null);
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

  const onModalKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") return;

    const focusableElements = getFocusableElements(modalRef.current);
    if (focusableElements.length === 0) {
      event.preventDefault();
      modalRef.current?.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === firstElement || document.activeElement === modalRef.current) {
        event.preventDefault();
        lastElement.focus();
      }
      return;
    }

    if (document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
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

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        aria-labelledby="import-books-title"
        aria-modal="true"
        className="import-modal"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onModalKeyDown}
        ref={modalRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="import-modal-header">
          <div className="stack-xs import-modal-copy">
            <h2 id="import-books-title">Add EPUBs</h2>
          </div>
          <button className="button button-secondary import-modal-dismiss" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div
          className={`import-dropzone${isDropTargetActive ? " import-dropzone-active" : ""}`}
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
          <button
            className="import-browse-button"
            onClick={() => fileInputRef.current?.click()}
            ref={browseButtonRef}
            type="button"
          >
            Browse files
          </button>
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
      </div>
    </div>,
    document.body,
  );
};

const UploadResults = ({ results }: { results: ImportResult[] }) => {
  if (results.length === 0) return null;

  return (
    <section aria-live="polite" className="panel stack-sm">
      <div className="section-heading">
        <h2>Import results</h2>
        <span>{numberFormatter.format(results.length)} file(s)</span>
      </div>
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
    </section>
  );
};

const SkeletonLine = ({ className = "" }: { className?: string }) => (
  <span aria-hidden="true" className={`skeleton-line${className ? ` ${className}` : ""}`} />
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
            <button
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              className="theme-toggle"
              onClick={toggle}
              type="button"
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
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
          <button
            className="button button-primary"
            disabled={uploading}
            onClick={() => setIsImportModalOpen(true)}
            type="button"
          >
            {uploading ? "Importing\u2026" : "Add EPUBs"}
          </button>
          {!settings?.defaultKindleEmail && (
            <Link className="button button-secondary" to="/settings">
              Add Kindle address
            </Link>
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
          <input
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
            <button
              aria-pressed={view === "grid"}
              className={`view-toggle-button ${view === "grid" ? "active" : ""}`}
              onClick={() => onChangeView("grid")}
              type="button"
            >
              <GridIcon />
              Grid
            </button>
            <button
              aria-pressed={view === "list"}
              className={`view-toggle-button ${view === "list" ? "active" : ""}`}
              onClick={() => onChangeView("list")}
              type="button"
            >
              <ListIcon />
              List
            </button>
          </div>
          <div className="stat-chip">
            <strong>{numberFormatter.format(books.length)}</strong>
            <span>books</span>
          </div>
        </div>
      </section>

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
  useDocumentTitle("Book detail \u2022 Irulan");

  const [book, setBook] = useState<BookDetail | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <Link className="backlink" to="/">
        <ArrowLeftIcon />
        Back to shelf
      </Link>

      <section className="panel detail-layout">
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
              <label className="field-label" htmlFor="recipient-email">
                Kindle address
              </label>
              <input
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
              <Link className="button button-secondary" to={`/books/${book.id}/read`}>
                Read in browser
              </Link>
              <button className="button button-primary" disabled={sending} type="submit">
                {sending ? "Sending\u2026" : "Send to Kindle"}
              </button>
              <Link className="button button-secondary" to="/settings">
                Delivery settings
              </Link>
            </div>
            {message ? (
              <p aria-live="polite" className="inline-success">
                {message}
              </p>
            ) : null}
            {error ? <p className="inline-error">{error}</p> : null}
          </form>
        </div>
      </section>

      <section className="panel stack-sm">
        <div className="section-heading">
          <h2>Delivery history</h2>
          <span>{numberFormatter.format(deliveries.length)} attempts</span>
        </div>
        {deliveries.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)", fontSize: 13 }}>No sends yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Recipient</th>
                  <th scope="col">Created</th>
                  <th scope="col">Sent</th>
                  <th scope="col">Error</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((delivery) => (
                  <tr key={delivery.id}>
                    <td>
                      <span className={`status-pill status-${delivery.status}`}>
                        {delivery.status}
                      </span>
                    </td>
                    <td>{delivery.recipientEmail}</td>
                    <td>{formatDate(delivery.createdAt)}</td>
                    <td>{formatDate(delivery.sentAt)}</td>
                    <td>{delivery.errorMessage ?? "\u2014"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
        <Link className="backlink" to={`/books/${bookId}`}>
          <ArrowLeftIcon />
          Back to book
        </Link>

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
        <Link className="backlink" to={`/books/${bookId}`}>
          <ArrowLeftIcon />
          Back to book
        </Link>

        <section className="empty-state stack-sm">
          <h2>Reader unavailable</h2>
          <p>{error ?? "This EPUB could not be opened in the browser."}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page stack-lg">
      <Link className="backlink" to={`/books/${bookId}`}>
        <ArrowLeftIcon />
        Back to book
      </Link>

      {error ? <p className="inline-error">{error}</p> : null}

      <section className="reader-shell">
        <aside className="panel reader-sidebar stack-sm">
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
            <label className="field-label" htmlFor="reader-section">
              Jump to section
            </label>
            <select
              id="reader-section"
              onChange={(event) => goToSection(event.currentTarget.value)}
              value={activeSection?.href ?? ""}
            >
              {reader.sections.map((section, index) => (
                <option key={section.id} value={section.href}>
                  {index + 1}. {section.label}
                </option>
              ))}
              {currentSectionIndex < 0 && activeSection ? (
                <option value={activeSection.href}>{activeSection.label}</option>
              ) : null}
            </select>
          </div>

          <nav aria-label="Table of contents" className="reader-toc">
            {reader.sections.map((section, index) => (
              <button
                aria-current={section.href === activeSection?.href ? "page" : undefined}
                className={`reader-toc-item ${section.href === activeSection?.href ? "active" : ""}`}
                key={section.id}
                onClick={() => goToSection(section.href)}
                type="button"
              >
                <span className="reader-toc-index">{index + 1}</span>
                <span className="reader-toc-label">{section.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="reader-content">
          <div className="reader-toolbar">
            <div className="reader-toolbar-nav">
              <button
                className="button button-secondary"
                disabled={!previousSection}
                onClick={() =>
                  previousSection ? goToSection(previousSection.href) : undefined
                }
                type="button"
              >
                Previous
              </button>
              <button
                className="button button-secondary"
                disabled={!nextSection}
                onClick={() => (nextSection ? goToSection(nextSection.href) : undefined)}
                type="button"
              >
                Next
              </button>
            </div>

            <strong className="reader-current-label">{activeSectionLabel}</strong>

            <div className="reader-toolbar-controls">
              <div aria-label="Reader tone" className="view-toggle" role="group">
                {(["paper", "sepia", "night"] as const).map((option) => (
                  <button
                    aria-pressed={tone === option}
                    className={`view-toggle-button ${tone === option ? "active" : ""}`}
                    key={option}
                    onClick={() => setTone(option)}
                    type="button"
                  >
                    {option === "paper"
                      ? "Paper"
                      : option === "sepia"
                        ? "Sepia"
                        : "Night"}
                  </button>
                ))}
              </div>

              <div aria-label="Type size" className="view-toggle" role="group">
                <button
                  aria-label="Decrease type size"
                  className="view-toggle-button"
                  disabled={fontScale <= READER_MIN_FONT_SCALE}
                  onClick={() => onAdjustFontScale(-READER_FONT_SCALE_STEP)}
                  type="button"
                >
                  A-
                </button>
                <div className="stat-chip reader-type-scale">
                  <strong>{Math.round(fontScale * 100)}%</strong>
                </div>
                <button
                  aria-label="Increase type size"
                  className="view-toggle-button"
                  disabled={fontScale >= READER_MAX_FONT_SCALE}
                  onClick={() => onAdjustFontScale(READER_FONT_SCALE_STEP)}
                  type="button"
                >
                  A+
                </button>
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
      <section className="panel stack-md">
        <div className="stack-xs">
          <h2>Kindle destination</h2>
          <p className="lede">
            Set a default Kindle email. SMTP credentials are read from <code>.env</code>.
          </p>
        </div>

        <form className="stack-sm" onSubmit={onSave}>
          <div className="stack-xs">
            <label className="field-label" htmlFor="default-kindle-email">
              Default Kindle email
            </label>
            <input
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
            <button className="button button-primary" disabled={saving} type="submit">
              {saving ? "Saving\u2026" : "Save"}
            </button>
            <button
              className="button button-secondary"
              disabled={testing || !defaultEmail.trim()}
              onClick={onSendTest}
              type="button"
            >
              {testing ? "Sending\u2026" : "Send test email"}
            </button>
          </div>
          {message ? (
            <p aria-live="polite" className="inline-success">
              {message}
            </p>
          ) : null}
          {error ? <p className="inline-error">{error}</p> : null}
        </form>
      </section>

      <section className="panel stack-sm">
        <div className="section-heading">
          <h2>SMTP status</h2>
          <span className={`status-pill ${settings?.smtpConfigured ? "status-sent" : "status-failed"}`}>
            {settings?.smtpConfigured ? "Configured" : "Missing"}
          </span>
        </div>
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
      </section>
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
