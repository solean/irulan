import type {
  CSSProperties,
  DragEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";
import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Link,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { LibraryBig, Monitor, Moon, MoreHorizontal, Settings2, StarIcon, Sun } from "lucide-react";

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
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider as RadixToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import {
  READ_STATUSES,
  type BookDetail,
  type BookReader,
  type BookReaderSection,
  type BookSummary,
  type BookshelfSummary,
  type DeliveryRecord,
  type ImportResult,
  type ReadStatus,
  type SmtpSettings,
  type SettingsPayload,
  type UpdateBookMetadataPayload,
} from "../shared/types";
import { api } from "./lib/api";
import {
  createReaderAssetSection,
  getReaderDocumentTitle,
  renderReaderDocument,
  type ReaderLinkTarget,
} from "./lib/reader";

type Theme = "light" | "dark";
type ThemePreference = "system" | Theme;
type BookshelfView = "grid" | "list";
type BookshelfDensity = "comfortable" | "compact";
type ReadStatusFilter = "all" | ReadStatus;
type ReaderTone = "paper" | "sepia" | "night";
type BookshelfSortKey =
  | "title"
  | "author"
  | "sourceFilename"
  | "importedAt"
  | "fileSizeBytes"
  | "readStatus"
  | "rating";
type SortDirection = "asc" | "desc";
type BookshelfSort = {
  key: BookshelfSortKey;
  direction: SortDirection;
};
type BookshelfContextMenuState = {
  book: BookSummary;
  x: number;
  y: number;
};
type ToastVariant = "default" | "success" | "warning" | "error";
type ToastNotice = {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
};
type ToastInput = Omit<ToastNotice, "id">;

const THEME_KEY = "ebook-manager-theme-preference";
const BOOKSHELF_VIEW_KEY = "ebook-manager-bookshelf-view";
const BOOKSHELF_DENSITY_KEY = "ebook-manager-bookshelf-density";
const ALL_BOOKSHELVES_ID = "all";
const READER_TONE_KEY = "ebook-manager-reader-tone";
const READER_FONT_SCALE_KEY = "ebook-manager-reader-font-scale";
const READER_MIN_FONT_SCALE = 0.95;
const READER_MAX_FONT_SCALE = 1.25;
const READER_FONT_SCALE_STEP = 0.1;
const IMPORT_BATCH_SIZE = 20;
const INVALID_IMPORT_FILES_MESSAGE = "Only EPUB files are supported.";
const DEFAULT_BOOKSHELF_SORT: BookshelfSort = {
  key: "importedAt",
  direction: "desc",
};
const BOOKSHELF_SORT_OPTIONS: ReadonlyArray<{ value: BookshelfSortKey; label: string }> = [
  { value: "importedAt", label: "Recently added" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "readStatus", label: "Read status" },
  { value: "rating", label: "Rating" },
  { value: "sourceFilename", label: "Filename" },
  { value: "fileSizeBytes", label: "File size" },
];
const READ_STATUS_LABELS: Record<ReadStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  finished: "Finished",
};
const READ_STATUS_OPTIONS: ReadonlyArray<{ value: ReadStatus; label: string }> =
  READ_STATUSES.map((value) => ({ value, label: READ_STATUS_LABELS[value] }));
const READ_STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: ReadStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "reading", label: "Reading" },
  { value: "unread", label: "Unread" },
  { value: "finished", label: "Finished" },
];
const READ_STATUS_ORDER: Record<ReadStatus, number> = {
  unread: 0,
  reading: 1,
  finished: 2,
};
const THEME_META_COLORS: Record<Theme, string> = {
  dark: "#15100B",
  light: "#F6F4EE",
};

function getStoredThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "system" || stored === null) return "system";
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* localStorage unavailable */
  }
  return "system";
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

function getStoredBookshelfDensity(): BookshelfDensity | null {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(BOOKSHELF_DENSITY_KEY);
    if (value === "comfortable" || value === "compact") {
      return value;
    }
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

function resolveTheme(preference: ThemePreference, systemTheme: Theme): Theme {
  return preference === "system" ? systemTheme : preference;
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      'input, textarea, select, [contenteditable], [role="combobox"], [role="textbox"]',
    )
  ) {
    return true;
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

const ThemeContext = createContext<{
  theme: Theme;
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  toggle: () => void;
}>({
  theme: "dark",
  themePreference: "system",
  setThemePreference: () => {},
  toggle: () => {},
});
const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

function createToastId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) {
    throw new Error("useToast must be used within AppToastProvider.");
  }
  return toast;
}

function AppToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastNotice[]>([]);

  const notify = useCallback((toast: ToastInput) => {
    setToasts((current) => [...current, { ...toast, id: createToastId() }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return (
    <RadixToastProvider>
      <ToastContext.Provider value={notify}>
        {children}
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            onOpenChange={(open) => {
              if (!open) removeToast(toast.id);
            }}
            variant={toast.variant}
          >
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description ? (
              <ToastDescription>{toast.description}</ToastDescription>
            ) : null}
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </ToastContext.Provider>
    </RadixToastProvider>
  );
}

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
  const systemTheme: Theme = prefersDark ? "dark" : "light";
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(
    getStoredThemePreference,
  );
  const theme = resolveTheme(themePreference, systemTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setThemePreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* noop */
    }
    setThemePreferenceState(next);
  }, []);

  const toggle = useCallback(() => {
    setThemePreferenceState((prev) => {
      const current = resolveTheme(prev, systemTheme);
      const next = current === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* noop */
      }
      return next;
    });
  }, [systemTheme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        !event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.key.toLowerCase() !== "d" ||
        isTextEntryTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      toggle();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [toggle]);

  return { theme, themePreference, setThemePreference, toggle };
}

const numberFormatter = new Intl.NumberFormat(undefined);
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const bookshelfTextCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
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

const TITLE_CASE_LOWERCASE_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "into",
  "nor",
  "of",
  "on",
  "or",
  "the",
  "to",
  "vs",
  "with",
]);

const formatDisplayTitle = (value: string) => {
  if (!value) return value;
  const tokens = value.split(/(\s+|[\-\u2013\u2014:])/u);
  let firstWordIndex = -1;
  let lastWordIndex = -1;
  const wordIndices: number[] = [];
  tokens.forEach((token, index) => {
    if (/^\s+$/.test(token) || /^[\-\u2013\u2014:]$/.test(token)) return;
    if (firstWordIndex === -1) firstWordIndex = index;
    lastWordIndex = index;
    wordIndices.push(index);
  });

  return tokens
    .map((token, index) => {
      if (!wordIndices.includes(index)) return token;
      const lower = token.toLocaleLowerCase();
      if (
        index !== firstWordIndex &&
        index !== lastWordIndex &&
        TITLE_CASE_LOWERCASE_WORDS.has(lower) &&
        token === token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
      ) {
        return lower;
      }
      return token;
    })
    .join("");
};

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

const formatRelative = (value: string | null): string | null => {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  const week = day * 7;
  const month = day * 30;
  const year = day * 365;
  if (abs < minute) return "just now";
  if (abs < hour) return relativeTimeFormatter.format(Math.round(diff / minute), "minute");
  if (abs < day) return relativeTimeFormatter.format(Math.round(diff / hour), "hour");
  if (abs < week) return relativeTimeFormatter.format(Math.round(diff / day), "day");
  if (abs < month) return relativeTimeFormatter.format(Math.round(diff / week), "week");
  if (abs < year) return relativeTimeFormatter.format(Math.round(diff / month), "month");
  return relativeTimeFormatter.format(Math.round(diff / year), "year");
};

const getDefaultBookshelfSortDirection = (key: BookshelfSortKey): SortDirection =>
  key === "importedAt" || key === "fileSizeBytes" || key === "rating" ? "desc" : "asc";

const getNextBookshelfSort = (current: BookshelfSort, key: BookshelfSortKey): BookshelfSort => {
  if (current.key === key) {
    return {
      key,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }

  return {
    key,
    direction: getDefaultBookshelfSortDirection(key),
  };
};

const compareBooks = (left: BookSummary, right: BookSummary, key: BookshelfSortKey) => {
  switch (key) {
    case "rating":
      return (left.rating ?? 0) - (right.rating ?? 0);
    case "readStatus":
      return READ_STATUS_ORDER[left.readStatus] - READ_STATUS_ORDER[right.readStatus];
    case "fileSizeBytes":
      return left.fileSizeBytes - right.fileSizeBytes;
    case "importedAt":
      return new Date(left.importedAt).getTime() - new Date(right.importedAt).getTime();
    case "author":
      return bookshelfTextCollator.compare(left.author, right.author);
    case "sourceFilename":
      return bookshelfTextCollator.compare(left.sourceFilename, right.sourceFilename);
    case "title":
    default:
      return bookshelfTextCollator.compare(left.title, right.title);
  }
};

const getVisibleBooks = (books: BookSummary[], query: string) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return books;
  }

  return books.filter((book) => {
    const title = book.title.toLocaleLowerCase();
    const author = book.author.toLocaleLowerCase();
    const sourceFilename = book.sourceFilename.toLocaleLowerCase();

    return (
      title.includes(normalizedQuery) ||
      author.includes(normalizedQuery) ||
      sourceFilename.includes(normalizedQuery)
    );
  });
};

const getSortedBooks = (books: BookSummary[], sort: BookshelfSort) => {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...books].sort((left, right) => compareBooks(left, right, sort.key) * direction);
};

const getBookshelfHref = (bookshelfId?: string | null) => {
  if (!bookshelfId) return "/";
  const params = new URLSearchParams({ shelf: bookshelfId });
  return `/?${params.toString()}`;
};

const getBookHref = (bookId: string, bookshelfId?: string | null) => {
  if (!bookshelfId) return `/books/${bookId}`;
  const params = new URLSearchParams({ shelf: bookshelfId });
  return `/books/${bookId}?${params.toString()}`;
};

const getReaderHref = (bookId: string, bookshelfId?: string | null) => {
  if (!bookshelfId) return `/books/${bookId}/read`;
  const params = new URLSearchParams({ shelf: bookshelfId });
  return `/books/${bookId}/read?${params.toString()}`;
};

const getReaderSearch = (bookshelfId?: string | null) =>
  bookshelfId ? new URLSearchParams({ shelf: bookshelfId }).toString() : "";

// Reading always happens in a dedicated window: a native window via the
// Electron bridge, or a separate browser window as a fallback. `search` is the
// reader query string (e.g. "shelf=…") without the leading "?".
const openReaderWindow = (bookId: string, search = "") => {
  const bridge = typeof window !== "undefined" ? window.irulan : undefined;
  if (bridge?.openReader) {
    void bridge.openReader(bookId, search);
    return;
  }

  const popoutSearch = search ? `${search}&popout=1` : "popout=1";
  window.open(
    `/books/${bookId}/read?${popoutSearch}`,
    "_blank",
    "noopener,width=900,height=1000",
  );
};

const getAriaSort = (
  sort: BookshelfSort,
  key: BookshelfSortKey,
): "ascending" | "descending" | "none" =>
  sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none";

const getContextMenuPosition = (x: number, y: number) => {
  const padding = 8;
  const menuWidth = 220;
  const menuHeight = 160;
  const maxX = Math.max(padding, window.innerWidth - menuWidth - padding);
  const maxY = Math.max(padding, window.innerHeight - menuHeight - padding);

  return {
    x: Math.min(Math.max(padding, x), maxX),
    y: Math.min(Math.max(padding, y), maxY),
  };
};

const isContextMenuKey = (event: ReactKeyboardEvent<HTMLElement>) =>
  event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");

const isFileDrag = (dataTransfer: DataTransfer | null) =>
  Array.from(dataTransfer?.items ?? []).some((item) => item.kind === "file") ||
  Array.from(dataTransfer?.types ?? []).includes("Files");

const isEpubFile = (file: File) =>
  file.name.toLowerCase().endsWith(".epub") || file.type === "application/epub+zip";

const getImportableFiles = (files: Iterable<File>) => Array.from(files).filter(isEpubFile);

type FileDropTargetOptions = {
  enabled?: boolean;
  onDropFiles: (files: File[]) => void;
};

const useFileDropTarget = ({ enabled = true, onDropFiles }: FileDropTargetOptions) => {
  const dragDepthRef = useRef(0);
  const [isActive, setIsActive] = useState(false);

  const reset = useCallback(() => {
    dragDepthRef.current = 0;
    setIsActive(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      reset();
    }
  }, [enabled, reset]);

  const onDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!enabled || !isFileDrag(event.dataTransfer)) return;

      event.preventDefault();
      dragDepthRef.current += 1;
      setIsActive(true);
    },
    [enabled],
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!enabled || !isFileDrag(event.dataTransfer)) return;

      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";

      if (!isActive) {
        setIsActive(true);
      }
    },
    [enabled, isActive],
  );

  const onDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!enabled || !isFileDrag(event.dataTransfer)) return;

      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsActive(false);
      }
    },
    [enabled],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!enabled || !isFileDrag(event.dataTransfer)) return;

      event.preventDefault();
      reset();
      onDropFiles(Array.from(event.dataTransfer.files));
    },
    [enabled, onDropFiles, reset],
  );

  return {
    isActive,
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    reset,
  };
};

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

const getImportToastVariant = (status: ImportResult["status"]): ToastVariant => {
  if (status === "imported") return "success";
  if (status === "duplicate") return "warning";
  return "error";
};

const getImportToastTitle = (status: ImportResult["status"]) => {
  if (status === "imported") return "Imported";
  if (status === "duplicate") return "Already in library";
  return "Import failed";
};

type SmtpFormState = {
  host: string;
  port: string;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

type BookshelfFormState = {
  name: string;
  kindleEmail: string;
};

const toSmtpFormState = (smtp: SettingsPayload["smtp"]): SmtpFormState => ({
  host: smtp.host,
  port: String(smtp.port),
  secure: smtp.secure,
  user: smtp.user,
  pass: smtp.pass,
  from: smtp.from,
});

const toBookshelfFormState = (bookshelf: BookshelfSummary): BookshelfFormState => ({
  name: bookshelf.name,
  kindleEmail: bookshelf.kindleEmail ?? "",
});

const toBookshelfFormMap = (bookshelves: BookshelfSummary[]) =>
  Object.fromEntries(
    bookshelves.map((bookshelf) => [bookshelf.id, toBookshelfFormState(bookshelf)]),
  );

const BookIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 3h4.5a2 2 0 0 1 2 2v9a1.5 1.5 0 0 0-1.5-1.5H2V3Z" />
    <path d="M14 3H9.5a2 2 0 0 0-2 2v9A1.5 1.5 0 0 1 9 12.5H14V3Z" />
  </svg>
);

const ArrowLeftIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M10 12 6 8l4-4" />
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

const DensityComfortableIcon = () => (
  <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect height="6" rx="1.2" width="6" x="1.5" y="1.5" />
    <rect height="6" rx="1.2" width="6" x="8.5" y="1.5" />
    <rect height="6" rx="1.2" width="6" x="1.5" y="8.5" />
    <rect height="6" rx="1.2" width="6" x="8.5" y="8.5" />
  </svg>
);

const DensityCompactIcon = () => (
  <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect height="3.5" rx="0.8" width="3.5" x="1.5" y="1.5" />
    <rect height="3.5" rx="0.8" width="3.5" x="6.25" y="1.5" />
    <rect height="3.5" rx="0.8" width="3.5" x="11" y="1.5" />
    <rect height="3.5" rx="0.8" width="3.5" x="1.5" y="6.25" />
    <rect height="3.5" rx="0.8" width="3.5" x="6.25" y="6.25" />
    <rect height="3.5" rx="0.8" width="3.5" x="11" y="6.25" />
    <rect height="3.5" rx="0.8" width="3.5" x="1.5" y="11" />
    <rect height="3.5" rx="0.8" width="3.5" x="6.25" y="11" />
    <rect height="3.5" rx="0.8" width="3.5" x="11" y="11" />
  </svg>
);


const ContentsIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 4h12M2 8h12M2 12h9" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
);

const ListComfortableIcon = () => (
  <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect height="3.5" rx="0.8" width="13" x="1.5" y="2" />
    <rect height="3.5" rx="0.8" width="13" x="1.5" y="10.5" />
  </svg>
);

const ListCompactIcon = () => (
  <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect height="1.6" rx="0.5" width="13" x="1.5" y="2" />
    <rect height="1.6" rx="0.5" width="13" x="1.5" y="5" />
    <rect height="1.6" rx="0.5" width="13" x="1.5" y="8" />
    <rect height="1.6" rx="0.5" width="13" x="1.5" y="11" />
  </svg>
);

const SortIcon = ({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) => (
  <svg
    aria-hidden="true"
    className={cn("books-table-sort-icon", active && "active")}
    viewBox="0 0 16 16"
  >
    <path
      d={
        active
          ? direction === "asc"
            ? "M5 10l3-4 3 4"
            : "M5 6l3 4 3-4"
          : "M5 6l3-3 3 3M5 10l3 3 3-3"
      }
    />
  </svg>
);

const UploadIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 16V5" />
    <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
    <path d="M5 19h14" />
  </svg>
);

const PlayIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5.5 3.4 12 8l-6.5 4.6z" fill="currentColor" stroke="none" />
  </svg>
);

const MoreIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

const CopyIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect height="9" rx="1.5" width="9" x="5" y="5" />
    <path d="M3 11V4a1 1 0 0 1 1-1h7" />
  </svg>
);

const EditIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m10.5 3 2.5 2.5L6 12.5H3.5V10z" />
  </svg>
);

const MailIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect height="10" rx="1.5" width="13" x="1.5" y="3" />
    <path d="m2 4 6 5 6-5" />
  </svg>
);

const formatRatingValue = (rating: number) =>
  Number.isInteger(rating) ? String(rating) : rating.toFixed(1);

const getRatingLabel = (rating: number | null) =>
  rating ? `${formatRatingValue(rating)} out of 5 stars` : "No rating";

const getStarFill = (rating: number | null, index: number) => {
  if (!rating) return 0;
  return Math.max(0, Math.min(1, rating - index));
};

const ReadStatusBadge = ({ status }: { status: ReadStatus }) => (
  <span className={cn("read-status-badge", `read-status-${status}`)}>
    {READ_STATUS_LABELS[status]}
  </span>
);

const RatingStars = ({
  compact = false,
  rating,
  filledOnly = false,
}: {
  compact?: boolean;
  rating: number | null;
  filledOnly?: boolean;
}) => {
  const label = getRatingLabel(rating);

  if (filledOnly) {
    if (!rating) return null;
    const wholeStars = Math.round(rating);
    return (
      <span
        aria-label={label}
        className={cn("rating-stars", "rating-stars-filled", compact && "rating-stars-compact")}
        title={label}
      >
        {Array.from({ length: wholeStars }, (_, index) => (
          <span aria-hidden="true" className="rating-star-frame is-filled" key={`rating-filled-${index}`}>
            <StarIcon />
          </span>
        ))}
      </span>
    );
  }

  return (
    <span
      aria-label={label}
      className={cn("rating-stars", compact && "rating-stars-compact")}
      title={label}
    >
      {Array.from({ length: 5 }, (_, index) => {
        const fill = getStarFill(rating, index);
        return (
          <span
            aria-hidden="true"
            className="rating-star-frame"
            key={`rating-star-${index}`}
            style={{ "--star-fill": `${fill * 100}%` } as CSSProperties}
          >
            <StarIcon className="rating-star-empty" />
            <span className="rating-star-fill">
              <StarIcon />
            </span>
          </span>
        );
      })}
      {!compact ? (
        <span className="rating-stars-label">
          {rating ? `${formatRatingValue(rating)}/5` : "No rating"}
        </span>
      ) : null}
    </span>
  );
};

const BookMetadataStrip = ({
  book,
  filledStarsOnly = false,
}: {
  book: BookSummary;
  filledStarsOnly?: boolean;
}) => (
  <span className="book-user-meta">
    <ReadStatusBadge status={book.readStatus} />
    {book.rating ? (
      <RatingStars compact rating={book.rating} filledOnly={filledStarsOnly} />
    ) : null}
  </span>
);

type RatingControlProps = {
  disabled?: boolean;
  rating: number | null;
  onChange: (rating: number | null) => void;
};

const RatingControl = ({ disabled = false, rating, onChange }: RatingControlProps) => (
  <div aria-label="Rating" className="rating-control" role="group">
    <div className="rating-slider-wrap">
      <RatingStars compact rating={rating} />
      <input
        aria-label={rating ? `Rating: ${getRatingLabel(rating)}` : "Rating: no rating"}
        aria-valuetext={rating ? getRatingLabel(rating) : "No rating"}
        className="rating-range"
        disabled={disabled}
        max={5}
        min={0}
        onChange={(event) => {
          const nextRating = Number(event.currentTarget.value);
          onChange(nextRating === 0 ? null : nextRating);
        }}
        step={0.5}
        type="range"
        value={rating ?? 0}
      />
    </div>
    <Button
      disabled={disabled || rating === null}
      onClick={() => onChange(null)}
      size="sm"
      type="button"
      variant="ghost"
    >
      Clear
    </Button>
  </div>
);

type BookMetadataEditorProps = {
  book: BookDetail;
  error: string | null;
  saving: boolean;
  onChange: (metadata: UpdateBookMetadataPayload) => void;
};

const BookMetadataEditor = ({
  book,
  error,
  saving,
  onChange,
}: BookMetadataEditorProps) => (
  <div className="reading-card">
    <div className="reading-card-header">
      <div className="send-card-title">
        <span>Book metadata</span>
      </div>
      {saving ? (
        <span aria-live="polite" className="reading-card-state">
          Saving{"\u2026"}
        </span>
      ) : null}
    </div>

    <div className="reading-controls">
      <div className="reading-control">
        <Label className="reading-control-label" id="read-status-label">
          Read status
        </Label>
        <Select
          disabled={saving}
          onValueChange={(value) => onChange({ readStatus: value as ReadStatus })}
          value={book.readStatus}
        >
          <SelectTrigger
            aria-labelledby="read-status-label"
            className="read-status-trigger"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {READ_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="reading-control">
        <Label className="reading-control-label">Rating</Label>
        <RatingControl
          disabled={saving}
          onChange={(rating) => onChange({ rating })}
          rating={book.rating}
        />
      </div>
    </div>

    {error ? (
      <p aria-live="polite" className="inline-error metadata-error">
        {error}
      </p>
    ) : null}
  </div>
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
        height={large ? 420 : 240}
        loading={large ? "eager" : "lazy"}
      />
    ) : (
      <PlaceholderCover title={book.title} />
    )}
  </div>
);

type ImportBooksModalProps = {
  disabled?: boolean;
  open: boolean;
  onClose: () => void;
  onImportFiles: (files: File[]) => void;
  onRejectFiles?: () => void;
};

const ImportBooksModal = ({
  disabled = false,
  open,
  onClose,
  onImportFiles,
  onRejectFiles,
}: ImportBooksModalProps) => {
  const browseButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const submitFiles = useCallback(
    (files: File[]) => {
      const importableFiles = getImportableFiles(files);
      if (importableFiles.length === 0) {
        onRejectFiles?.();
        onClose();
        return;
      }

      onImportFiles(importableFiles);
      onClose();
    },
    [onClose, onImportFiles, onRejectFiles],
  );
  const {
    isActive: isDropTargetActive,
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    reset,
  } = useFileDropTarget({
    enabled: open && !disabled,
    onDropFiles: submitFiles,
  });

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }

    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    browseButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      reset();
      previousActiveElement?.focus();
    };
  }, [open, reset]);

  if (!open) return null;

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
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <div className="import-dropzone-icon">
            <UploadIcon />
          </div>
          <p className="import-dropzone-title">
            {isDropTargetActive ? "Release to upload" : "Drag and Drop here"}
          </p>
          <p className="import-dropzone-divider">or</p>
          <Button
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            ref={browseButtonRef}
            size="lg"
            type="button"
          >
            Browse files
          </Button>
          <input
            accept=".epub,application/epub+zip"
            aria-hidden="true"
            className="sr-only"
            disabled={disabled}
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

type ImportTargetModalProps = {
  disabled?: boolean;
  fileCount: number;
  bookshelves: BookshelfSummary[];
  open: boolean;
  selectedBookshelfIds: string[];
  onClose: () => void;
  onConfirm: () => void;
  onClearBookshelves: () => void;
  onSelectAllBookshelves: () => void;
  onToggleBookshelf: (bookshelfId: string) => void;
};

const ImportTargetModal = ({
  disabled = false,
  fileCount,
  bookshelves,
  open,
  selectedBookshelfIds,
  onClose,
  onConfirm,
  onClearBookshelves,
  onSelectAllBookshelves,
  onToggleBookshelf,
}: ImportTargetModalProps) => {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileLabel =
    fileCount === 1
      ? "1 EPUB is ready to import."
      : `${numberFormatter.format(fileCount)} EPUBs are ready to import.`;
  const selectedCount = selectedBookshelfIds.length;
  const selectedLabel =
    selectedCount === 1
      ? "1 bookshelf selected"
      : `${numberFormatter.format(selectedCount)} bookshelves selected`;
  const confirmLabel =
    selectedCount === 1
      ? "Import to 1 bookshelf"
      : `Import to ${numberFormatter.format(selectedCount)} bookshelves`;
  const allBookshelvesSelected =
    bookshelves.length > 0 && selectedBookshelfIds.length === bookshelves.length;

  useEffect(() => {
    if (open) {
      confirmButtonRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!disabled && !nextOpen) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent
        className="import-target-modal gap-5 sm:max-w-[480px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmButtonRef.current?.focus();
        }}
        showCloseButton={false}
      >
        <DialogHeader className="stack-xs gap-1">
          <DialogTitle className="text-[20px] font-semibold tracking-[-0.02em]">
            Choose bookshelves
          </DialogTitle>
          <p className="import-target-copy">
            {fileLabel} {selectedLabel}.
          </p>
        </DialogHeader>

        <div className="import-target-actions">
          <Button
            disabled={disabled || allBookshelvesSelected}
            onClick={onSelectAllBookshelves}
            size="sm"
            type="button"
            variant="outline"
          >
            Select all
          </Button>
          <Button
            disabled={disabled || selectedCount === 0}
            onClick={onClearBookshelves}
            size="sm"
            type="button"
            variant="ghost"
          >
            Clear
          </Button>
        </div>

        <fieldset className="import-target-list">
          <legend className="sr-only">Import destination</legend>
          {bookshelves.map((bookshelf) => (
            <label className="import-target-row" key={bookshelf.id}>
              <input
                checked={selectedBookshelfIds.includes(bookshelf.id)}
                disabled={disabled}
                name={`import_bookshelf_${bookshelf.id}`}
                onChange={() => onToggleBookshelf(bookshelf.id)}
                type="checkbox"
                value={bookshelf.id}
              />
              <span className="import-target-copy-block">
                <span className="import-target-name">{bookshelf.name}</span>
                <span className="import-target-meta">
                  {numberFormatter.format(bookshelf.bookCount)} books
                  {bookshelf.kindleEmail ? ` · ${bookshelf.kindleEmail}` : ""}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="confirm-modal-actions">
          <Button disabled={disabled} onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            className="import-target-confirm"
            disabled={disabled || selectedCount === 0}
            onClick={onConfirm}
            ref={confirmButtonRef}
            type="button"
          >
            {disabled ? "Importing\u2026" : confirmLabel}
          </Button>
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

type SendBookModalProps = {
  open: boolean;
  sending: boolean;
  error: string | null;
  bookTitle: string;
  recipientEmail: string;
  onClose: () => void;
  onConfirm: () => void;
};

const SendBookModal = ({
  open,
  sending,
  error,
  bookTitle,
  recipientEmail,
  onClose,
  onConfirm,
}: SendBookModalProps) => (
  <AlertDialog
    onOpenChange={(nextOpen) => {
      if (!sending && !nextOpen) {
        onClose();
      }
    }}
    open={open}
  >
    <AlertDialogContent
      className="confirm-modal gap-6 sm:max-w-[460px]"
      onEscapeKeyDown={(event) => {
        if (sending) {
          event.preventDefault();
        }
      }}
    >
      <div className="stack-sm">
        <div className="stack-xs">
          <p className="eyebrow">Send to Kindle</p>
          <AlertDialogTitle className="text-left text-[20px] font-semibold tracking-[-0.02em]">
            Send this book to your Kindle?
          </AlertDialogTitle>
        </div>
        <AlertDialogDescription className="confirm-modal-copy text-left">
          <strong className="font-semibold text-[var(--text-primary)]">{bookTitle}</strong> will be
          emailed to <strong className="font-semibold text-[var(--text-primary)]">{recipientEmail}</strong>.
          Amazon may still reject it if the sender is not approved.
        </AlertDialogDescription>
      </div>

      {error ? (
        <p aria-live="polite" className="inline-error">
          {error}
        </p>
      ) : null}

      <div className="confirm-modal-actions">
        <AlertDialogCancel disabled={sending} onClick={onClose}>
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction
          disabled={sending}
          onClick={(event) => {
            event.preventDefault();
            if (!sending) {
              onConfirm();
            }
          }}
        >
          {sending ? "Sending\u2026" : "Send to Kindle"}
        </AlertDialogAction>
      </div>
    </AlertDialogContent>
  </AlertDialog>
);

type OverflowMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  variant?: "default" | "destructive";
  disabled?: boolean;
};

type OverflowMenuProps = {
  label: string;
  items: OverflowMenuItem[];
};

type BookActionMenuProps = {
  items: OverflowMenuItem[];
  onClose: () => void;
  x: number;
  y: number;
};

const OverflowMenu = ({ label, items }: OverflowMenuProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="overflow-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="overflow-menu-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <MoreIcon />
      </button>
      {open ? (
        <div className="overflow-menu-popover" role="menu">
          {items.map((item) => (
            <button
              className={cn(
                "overflow-menu-item",
                item.variant === "destructive" && "destructive",
              )}
              disabled={item.disabled}
              key={item.id}
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onSelect();
              }}
              role="menuitem"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const BookActionMenu = ({ items, onClose, x, y }: BookActionMenuProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const firstItem = containerRef.current?.querySelector<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    firstItem?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const closeOnViewportChange = () => onClose();

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", closeOnViewportChange, true);
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", closeOnViewportChange, true);
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [onClose]);

  return (
    <div
      aria-label="Book actions"
      className="overflow-menu-popover context-menu-popover"
      ref={containerRef}
      role="menu"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          className={cn(
            "overflow-menu-item",
            item.variant === "destructive" && "destructive",
          )}
          disabled={item.disabled}
          key={item.id}
          onClick={() => {
            if (item.disabled) return;
            onClose();
            item.onSelect();
          }}
          role="menuitem"
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};

const SkeletonLine = ({ className = "" }: { className?: string }) => (
  <Skeleton aria-hidden="true" className={`skeleton-line${className ? ` ${className}` : ""}`} />
);

const BookshelfSkeleton = ({ view }: { view: BookshelfView }) => {
  if (view === "list") {
    return (
      <section aria-hidden="true" className="books-table-shell books-table-skeleton">
        <Table className="books-table">
          <colgroup>
            <col className="books-table-col-title" />
            <col className="books-table-col-author" />
            <col className="books-table-col-file" />
            <col className="books-table-col-imported" />
            <col className="books-table-col-size" />
          </colgroup>
          <TableHeader className="[&_tr]:border-0">
            <TableRow className="books-table-row border-0">
              <TableHead scope="col">Title</TableHead>
              <TableHead scope="col">Author</TableHead>
              <TableHead scope="col">File</TableHead>
              <TableHead scope="col">Imported</TableHead>
              <TableHead className="books-table-size-cell" scope="col">
                Size
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 6 }, (_, index) => (
              <TableRow className="books-table-row border-0" key={`bookshelf-list-skeleton-${index}`}>
                <TableCell className="books-table-title-cell">
                  <div className="books-table-title-content">
                    <div className="books-table-cover">
                      <div className="book-cover">
                        <div className="skeleton-block skeleton-cover" />
                      </div>
                    </div>
                    <div className="books-table-title-stack stack-xs">
                      <SkeletonLine className="skeleton-line-title" />
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <SkeletonLine className="skeleton-line-medium" />
                </TableCell>
                <TableCell>
                  <SkeletonLine className="skeleton-line-medium" />
                </TableCell>
                <TableCell>
                  <SkeletonLine className="skeleton-line-medium" />
                </TableCell>
                <TableCell className="books-table-size-cell">
                  <SkeletonLine className="skeleton-line-small" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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

type BookshelfBookActionProps = {
  onBookContextKeyDown: (book: BookSummary, event: ReactKeyboardEvent<HTMLElement>) => void;
  onBookContextMenu: (book: BookSummary, event: MouseEvent<HTMLElement>) => void;
};

type BookshelfGridProps = {
  books: BookSummary[];
  bookshelfId?: string | null;
  density: BookshelfDensity;
  sortKey: BookshelfSortKey;
  onOpenActionMenu: (book: BookSummary, rect: DOMRect) => void;
} & BookshelfBookActionProps;

const BookshelfGrid = ({
  books,
  bookshelfId,
  density,
  sortKey,
  onBookContextKeyDown,
  onBookContextMenu,
  onOpenActionMenu,
}: BookshelfGridProps) => (
  <section
    aria-label="Bookshelf grid"
    className={cn("books-grid", `books-grid-${density}`)}
  >
    {books.map((book) => {
      const addedRelative = formatRelative(book.importedAt);
      const addedFull = formatDate(book.importedAt);
      const displayTitle = formatDisplayTitle(book.title);
      const showAddedRow = sortKey !== "importedAt" && addedRelative;
      return (
        <div className="book-card-shell" key={book.id}>
          <Link
            aria-label={`Open ${book.title} by ${book.author}`}
            className="book-card"
            onContextMenu={(event) => onBookContextMenu(book, event)}
            onKeyDown={(event) => onBookContextKeyDown(book, event)}
            to={getBookHref(book.id, bookshelfId)}
            title={book.title}
          >
            <div className="book-cover-wrap">
              <BookCover book={book} />
              {book.readStatus === "reading" ? (
                <span aria-hidden="true" className="book-cover-progress" />
              ) : null}
            </div>
            <div className="book-card-copy stack-xs">
              <strong className="book-title" title={book.title}>
                {displayTitle}
              </strong>
              <span className="book-author" title={book.author}>
                {book.author}
              </span>
              <BookMetadataStrip book={book} filledStarsOnly />
              {showAddedRow ? (
                <span className="book-meta" title={addedFull}>
                  {`Added ${addedRelative}`}
                </span>
              ) : null}
            </div>
          </Link>
          <button
            aria-label={`Actions for ${book.title}`}
            className="book-card-action-trigger"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
              onOpenActionMenu(book, rect);
            }}
            type="button"
          >
            <MoreIcon />
          </button>
        </div>
      );
    })}
  </section>
);

type BookshelfListProps = {
  books: BookSummary[];
  bookshelfId?: string | null;
  density: BookshelfDensity;
  sort: BookshelfSort;
  onChangeSort: (key: BookshelfSortKey) => void;
} & BookshelfBookActionProps;

const BookshelfSortButton = ({
  label,
  sortKey,
  sort,
  onChangeSort,
}: {
  label: string;
  sortKey: BookshelfSortKey;
  sort: BookshelfSort;
  onChangeSort: (key: BookshelfSortKey) => void;
}) => {
  const isActive = sort.key === sortKey;

  return (
    <button
      className={cn("books-table-sort-button", isActive && "active")}
      onClick={() => onChangeSort(sortKey)}
      title={`Sort by ${label}`}
      type="button"
    >
      <span>{label}</span>
      <SortIcon active={isActive} direction={sort.direction} />
    </button>
  );
};

const BookshelfList = ({
  books,
  bookshelfId,
  density,
  sort,
  onBookContextKeyDown,
  onBookContextMenu,
  onChangeSort,
}: BookshelfListProps) => {
  return (
    <section
      aria-label="Bookshelf list"
      className={cn("books-table-shell", `books-table-shell-${density}`)}
    >
      <Table className={cn("books-table", `books-table-${density}`)}>
        <colgroup>
          <col className="books-table-col-title" />
          <col className="books-table-col-author" />
          <col className="books-table-col-file" />
          <col className="books-table-col-imported" />
          <col className="books-table-col-size" />
        </colgroup>
        <TableHeader className="[&_tr]:border-0">
          <TableRow className="books-table-row border-0">
            <TableHead aria-sort={getAriaSort(sort, "title")} scope="col">
              <BookshelfSortButton
                label="Title"
                onChangeSort={onChangeSort}
                sort={sort}
                sortKey="title"
              />
            </TableHead>
            <TableHead aria-sort={getAriaSort(sort, "author")} scope="col">
              <BookshelfSortButton
                label="Author"
                onChangeSort={onChangeSort}
                sort={sort}
                sortKey="author"
              />
            </TableHead>
            <TableHead aria-sort={getAriaSort(sort, "sourceFilename")} scope="col">
              <BookshelfSortButton
                label="File"
                onChangeSort={onChangeSort}
                sort={sort}
                sortKey="sourceFilename"
              />
            </TableHead>
            <TableHead aria-sort={getAriaSort(sort, "importedAt")} scope="col">
              <BookshelfSortButton
                label="Imported"
                onChangeSort={onChangeSort}
                sort={sort}
                sortKey="importedAt"
              />
            </TableHead>
            <TableHead
              aria-sort={getAriaSort(sort, "fileSizeBytes")}
              className="books-table-size-cell"
              scope="col"
            >
              <BookshelfSortButton
                label="Size"
                onChangeSort={onChangeSort}
                sort={sort}
                sortKey="fileSizeBytes"
              />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {books.map((book) => (
            <TableRow
              className="books-table-row border-0"
              key={book.id}
              onContextMenu={(event) => onBookContextMenu(book, event)}
            >
              <TableCell className="books-table-title-cell">
                <div className="books-table-title-content">
                  <Link
                    aria-label={`Open ${book.title}`}
                    className="books-table-cover"
                    onKeyDown={(event) => onBookContextKeyDown(book, event)}
                    to={getBookHref(book.id, bookshelfId)}
                  >
                    <BookCover book={book} />
                  </Link>
                  <div className="books-table-title-stack">
                    <Link
                      className="books-table-title-link"
                      onKeyDown={(event) => onBookContextKeyDown(book, event)}
                      title={book.title}
                      to={getBookHref(book.id, bookshelfId)}
                    >
                      {formatDisplayTitle(book.title)}
                    </Link>
                    <BookMetadataStrip book={book} filledStarsOnly />
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <span className="books-table-text" title={book.author}>
                  {book.author}
                </span>
              </TableCell>
              <TableCell>
                <span className="books-table-text" title={book.sourceFilename}>
                  {book.sourceFilename}
                </span>
              </TableCell>
              <TableCell>
                <span className="books-table-text">{formatDate(book.importedAt)}</span>
              </TableCell>
              <TableCell className="books-table-size-cell">
                <span className="books-table-text">{formatBytes(book.fileSizeBytes)}</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
};

type BookshelfSidebarProps = {
  activeBookshelfId: string | null;
  bookshelves: BookshelfSummary[];
  totalBookCount: number;
  statusFilter: ReadStatusFilter;
  statusCounts: Record<ReadStatusFilter, number>;
  onSelectBookshelf: (bookshelfId: string) => void;
  onChangeStatusFilter: (status: ReadStatusFilter) => void;
};

type SidebarItemProps = {
  active: boolean;
  count: number;
  label: string;
  onSelect: () => void;
  title?: string;
  variant?: "library" | "status";
  statusKey?: ReadStatusFilter;
};

const SidebarItem = ({
  active,
  count,
  label,
  onSelect,
  title,
  variant = "library",
  statusKey,
}: SidebarItemProps) => (
  <button
    aria-pressed={active}
    className={cn(
      "sidebar-item",
      `sidebar-item-${variant}`,
      statusKey && `sidebar-item-status-${statusKey}`,
      active && "active",
    )}
    onClick={onSelect}
    title={title}
    type="button"
  >
    {variant === "status" && statusKey && statusKey !== "all" ? (
      <span aria-hidden="true" className={cn("sidebar-item-dot", `sidebar-item-dot-${statusKey}`)} />
    ) : null}
    <span className="sidebar-item-name">{label}</span>
    <span className="sidebar-item-count">{numberFormatter.format(count)}</span>
  </button>
);

const BookshelfSidebar = ({
  activeBookshelfId,
  bookshelves,
  totalBookCount,
  statusFilter,
  statusCounts,
  onSelectBookshelf,
  onChangeStatusFilter,
}: BookshelfSidebarProps) => (
  <aside aria-label="Library navigation" className="bookshelf-sidebar">
    <Link aria-label="Irulan home" className="sidebar-brand" to="/">
      <span className="sidebar-brand-mark" aria-hidden="true">
        <BookIcon />
      </span>
      <span className="sidebar-brand-name">irulan</span>
    </Link>

    <section className="sidebar-section">
      <h2 className="sidebar-section-title">Library</h2>
      <div className="sidebar-list" role="group">
        <SidebarItem
          active={activeBookshelfId === ALL_BOOKSHELVES_ID}
          count={totalBookCount}
          label="All books"
          onSelect={() => onSelectBookshelf(ALL_BOOKSHELVES_ID)}
        />
        {bookshelves.map((bookshelf) => (
          <SidebarItem
            active={activeBookshelfId === bookshelf.id}
            count={bookshelf.bookCount}
            key={bookshelf.id}
            label={bookshelf.name}
            onSelect={() => onSelectBookshelf(bookshelf.id)}
            title={bookshelf.kindleEmail ?? undefined}
          />
        ))}
      </div>
    </section>

    <section className="sidebar-section">
      <h2 className="sidebar-section-title">Status</h2>
      <div className="sidebar-list" role="radiogroup">
        {READ_STATUS_FILTER_OPTIONS.map((option) => (
          <SidebarItem
            active={statusFilter === option.value}
            count={statusCounts[option.value]}
            key={option.value}
            label={option.label}
            onSelect={() => onChangeStatusFilter(option.value)}
            variant="status"
            statusKey={option.value}
          />
        ))}
      </div>
    </section>
  </aside>
);

const BookDetailSkeleton = () => (
  <div aria-busy="true" className="page page-narrow stack-lg">
    <div className="detail-page-header">
      <Link className="backlink" to="/">
        <ArrowLeftIcon />
        Bookshelf
      </Link>
    </div>

    <section aria-hidden="true" className="detail-hero">
      <div className="detail-cover-clickable">
        <div className="book-cover book-cover-large">
          <div className="skeleton-block skeleton-cover" />
        </div>
      </div>
      <div className="detail-identity stack-md">
        <div className="stack-xs">
          <SkeletonLine className="skeleton-line-heading" />
          <SkeletonLine className="skeleton-line-author" />
          <SkeletonLine className="skeleton-line-meta" />
        </div>

        <div className="send-card">
          <div className="send-card-header">
            <div className="send-card-title">
              <span className="skeleton-circle" />
              <SkeletonLine className="skeleton-line-medium" />
            </div>
            <span className="skeleton-pill" />
          </div>
          <div className="send-recipient-display">
            <div className="send-recipient-info">
              <SkeletonLine className="skeleton-line-eyebrow" />
              <SkeletonLine className="skeleton-line-medium" />
            </div>
            <div className="skeleton-button skeleton-button-sm" />
          </div>
          <div className="send-card-actions">
            <div className="skeleton-button" />
          </div>
        </div>

        <SkeletonLine className="skeleton-line-small" />
      </div>
    </section>

    <section aria-hidden="true" className="panel stack-sm">
      <div className="section-heading">
        <SkeletonLine className="skeleton-line-section" />
      </div>
      <dl className="about-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`book-detail-about-skeleton-${index}`}>
            <dt>
              <SkeletonLine className="skeleton-line-eyebrow" />
            </dt>
            <dd>
              <SkeletonLine
                className={
                  index === 3 ? "skeleton-line-meta" : "skeleton-line-medium"
                }
              />
            </dd>
          </div>
        ))}
      </dl>
    </section>

    <section aria-hidden="true" className="panel stack-sm">
      <div className="section-heading">
        <SkeletonLine className="skeleton-line-section" />
        <SkeletonLine className="skeleton-line-small" />
      </div>
      <div className="history-list">
        {Array.from({ length: 3 }, (_, index) => (
          <div className="history-row" key={`delivery-history-skeleton-${index}`}>
            <div className="history-row-main">
              <span className="skeleton-pill" />
              <div className="history-row-text">
                <SkeletonLine className="skeleton-line-medium" />
                <SkeletonLine className="skeleton-line-small" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>

    <section aria-hidden="true" className="panel danger-zone-card">
      <div className="danger-zone-content">
        <div className="stack-xs skeleton-flex-fill">
          <SkeletonLine className="skeleton-line-eyebrow" />
          <SkeletonLine className="skeleton-line-paragraph" />
        </div>
        <div className="skeleton-button skeleton-button-secondary" />
      </div>
    </section>
  </div>
);

const SettingsSkeleton = () => (
  <div aria-busy="true" className="page page-narrow stack-lg">
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

const getFocusableMenuItems = (container: HTMLElement | null) =>
  Array.from(
    container?.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? [],
  );

const AppMenu = () => {
  const location = useLocation();
  const { setThemePreference, themePreference } = useContext(ThemeContext);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuActive = location.pathname === "/settings" || location.pathname === "/bookshelves";

  const closeMenu = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    const firstItem = getFocusableMenuItems(popoverRef.current)[0];
    firstItem?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        closeMenu();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu(true);
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [closeMenu, open]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    const items = getFocusableMenuItems(popoverRef.current);
    if (items.length === 0) return;

    event.preventDefault();
    const activeIndex = items.findIndex((item) => item === document.activeElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (activeIndex + 1) % items.length
            : (activeIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus({ preventScroll: true });
  };

  return (
    <div className="app-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open app menu"
        className={cn("main-header-action app-menu-trigger", menuActive && "active")}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <MoreHorizontal aria-hidden="true" />
      </button>

      {open ? (
        <div
          aria-label="App menu"
          className="app-menu-popover"
          onKeyDown={onMenuKeyDown}
          ref={popoverRef}
          role="menu"
        >
          <Link
            className="app-menu-item"
            onClick={() => closeMenu()}
            role="menuitem"
            to="/settings"
          >
            <Settings2 aria-hidden="true" />
            <span>Settings</span>
          </Link>
          <Link
            className="app-menu-item"
            onClick={() => closeMenu()}
            role="menuitem"
            to="/bookshelves"
          >
            <LibraryBig aria-hidden="true" />
            <span>Bookshelves</span>
          </Link>

          <div className="app-menu-separator" role="separator" />

          <div aria-label="Theme" className="app-menu-theme-row" role="group">
            <span className="app-menu-theme-label">Theme</span>
            <div className="app-menu-theme-toggle">
              <button
                aria-checked={themePreference === "system"}
                aria-label="Use system theme"
                className={cn("app-menu-theme-button", themePreference === "system" && "active")}
                onClick={() => setThemePreference("system")}
                role="menuitemradio"
                type="button"
              >
                <Monitor aria-hidden="true" />
              </button>
              <button
                aria-checked={themePreference === "light"}
                aria-label="Use light mode"
                className={cn("app-menu-theme-button", themePreference === "light" && "active")}
                onClick={() => setThemePreference("light")}
                role="menuitemradio"
                type="button"
              >
                <Sun aria-hidden="true" />
              </button>
              <button
                aria-checked={themePreference === "dark"}
                aria-label="Use dark mode"
                className={cn("app-menu-theme-button", themePreference === "dark" && "active")}
                onClick={() => setThemePreference("dark")}
                role="menuitemradio"
                type="button"
              >
                <Moon aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const Shell = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isPopout = searchParams.get("popout") === "1";

  const pageTitle = (() => {
    if (location.pathname === "/settings") return "Settings";
    if (location.pathname === "/bookshelves") return "Bookshelves";
    if (location.pathname.startsWith("/books/") && location.pathname.endsWith("/read")) {
      return "Reader";
    }
    if (location.pathname.startsWith("/books/")) return "Book detail";
    return "Bookshelf";
  })();

  // A popped-out reader window drops the app chrome entirely — just a slim
  // draggable strip (so the macOS traffic lights have somewhere to live) and
  // the reader itself. Same ReaderPage component, no second implementation.
  if (isPopout) {
    return (
      <>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        <div className="app-shell app-shell-popout">
          <main className="popout-main" id="content">
            <h1 className="sr-only">{pageTitle}</h1>
            <Outlet />
          </main>
        </div>
      </>
    );
  }

  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <div className="app-shell">
        <header className="main-header">
          <div className="main-header-inner">
            <div className="header-spacer" />
            <div aria-label="App controls" className="main-header-actions" role="group">
              <AppMenu />
            </div>
          </div>
        </header>
        <main className="content" id="content">
          <h1 className="sr-only">{pageTitle}</h1>
          <Outlet />
        </main>
      </div>
    </>
  );
};

const BookshelfPage = () => {

  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [view, setView] = useState<BookshelfView>(() => getStoredBookshelfView() ?? "grid");
  const [density, setDensity] = useState<BookshelfDensity>(
    () => getStoredBookshelfDensity() ?? "comfortable",
  );
  const [statusFilter, setStatusFilter] = useState<ReadStatusFilter>("all");
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [bookshelfSort, setBookshelfSort] = useState<BookshelfSort>(DEFAULT_BOOKSHELF_SORT);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [pendingImportFiles, setPendingImportFiles] = useState<File[]>([]);
  const [isImportTargetModalOpen, setIsImportTargetModalOpen] = useState(false);
  const [selectedImportBookshelfIds, setSelectedImportBookshelfIds] = useState<string[]>([]);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [bookshelves, setBookshelves] = useState<BookshelfSummary[]>([]);
  const [hasLoadedBooks, setHasLoadedBooks] = useState(false);
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const [hasLoadedBookshelves, setHasLoadedBookshelves] = useState(false);
  const [bookActionMenu, setBookActionMenu] = useState<BookshelfContextMenuState | null>(null);
  const [sendingBookId, setSendingBookId] = useState<string | null>(null);
  const [bookPendingSend, setBookPendingSend] = useState<BookSummary | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [bookPendingDelete, setBookPendingDelete] = useState<BookSummary | null>(null);
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const latestBooksRequest = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const flashMessage = (location.state as { message?: string } | null)?.message ?? null;

  const requestedBookshelfId = searchParams.get("shelf");
  const activeBookshelfId =
    requestedBookshelfId === ALL_BOOKSHELVES_ID
      ? ALL_BOOKSHELVES_ID
      : bookshelves.some((bookshelf) => bookshelf.id === requestedBookshelfId)
        ? requestedBookshelfId
        : bookshelves[0]?.id ?? null;
  const activeBookshelf =
    activeBookshelfId && activeBookshelfId !== ALL_BOOKSHELVES_ID
      ? bookshelves.find((bookshelf) => bookshelf.id === activeBookshelfId) ?? null
      : null;
  const canImportBooks = Boolean(activeBookshelf || bookshelves.length > 0);
  const shelfLabel =
    activeBookshelfId === ALL_BOOKSHELVES_ID
      ? "All books"
      : activeBookshelf?.name ?? "Bookshelf";
  useDocumentTitle(`${shelfLabel} — Irulan`);
  const deferredQuery = useDeferredValue(query);
  const queriedBooks = useMemo(() => getVisibleBooks(books, deferredQuery), [books, deferredQuery]);
  const statusCounts = useMemo(() => {
    const counts: Record<ReadStatusFilter, number> = {
      all: queriedBooks.length,
      unread: 0,
      reading: 0,
      finished: 0,
    };
    for (const book of queriedBooks) {
      counts[book.readStatus] += 1;
    }
    return counts;
  }, [queriedBooks]);
  const visibleBooks = useMemo(
    () =>
      statusFilter === "all"
        ? queriedBooks
        : queriedBooks.filter((book) => book.readStatus === statusFilter),
    [queriedBooks, statusFilter],
  );
  const sortedVisibleBooks = useMemo(
    () => getSortedBooks(visibleBooks, bookshelfSort),
    [visibleBooks, bookshelfSort],
  );
  const showingFilteredResults =
    deferredQuery.trim().length > 0 || statusFilter !== "all";
  const canSendToKindleFromShelf = Boolean(settings?.smtp.configured && activeBookshelf?.kindleEmail?.trim());

  const loadBookshelves = useEffectEvent(async () => {
    try {
      const [nextBookshelves, nextSettings] = await Promise.all([
        api.listBookshelves(),
        hasLoadedSettings ? Promise.resolve<SettingsPayload | null>(null) : api.getSettings(),
      ]);
      setBookshelves(nextBookshelves);
      setHasLoadedBookshelves(true);
      if (nextBookshelves.length === 0) {
        setBooks([]);
        setLoading(false);
        setHasLoadedBooks(true);
      }

      if (nextSettings) {
        setSettings(nextSettings);
        setHasLoadedSettings(true);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not load bookshelves.",
      );
      setHasLoadedBookshelves(true);
      setLoading(false);
      setHasLoadedBooks(true);
    }
  });

  const loadBooks = useEffectEvent(async () => {
    if (!activeBookshelfId) return;

    const requestId = latestBooksRequest.current + 1;
    latestBooksRequest.current = requestId;

    if (!hasLoadedBooks) {
      setLoading(true);
    }
    setError(null);

    try {
      const nextBooks = await api.listBooks(
        "",
        activeBookshelfId === ALL_BOOKSHELVES_ID ? null : activeBookshelfId,
      );

      if (requestId !== latestBooksRequest.current) {
        return;
      }

      setBooks(nextBooks);
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
    void loadBookshelves();
  }, []);

  useEffect(() => {
    if (!hasLoadedBookshelves || !activeBookshelfId) return;
    void loadBooks();
  }, [activeBookshelfId, hasLoadedBookshelves]);

  useEffect(() => {
    if (!hasLoadedBookshelves || bookshelves.length === 0) return;
    const shelfParam = searchParams.get("shelf");
    const shelfExists =
      shelfParam === ALL_BOOKSHELVES_ID ||
      bookshelves.some((bookshelf) => bookshelf.id === shelfParam);

    if (shelfExists) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("shelf", bookshelves[0].id);
    setSearchParams(nextParams, { replace: true });
  }, [bookshelves, hasLoadedBookshelves, searchParams, setSearchParams]);

  useEffect(() => {
    const nextQuery = searchParams.get("q") ?? "";
    setQuery((current) => (current === nextQuery ? current : nextQuery));
  }, [searchParams]);

  useEffect(() => {
    if (!flashMessage) return;

    toast({
      title: "Deleted",
      description: flashMessage,
      variant: "success",
    });
    navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null },
    );
  }, [flashMessage, location.pathname, location.search, navigate, toast]);

  useEffect(() => {
    if (!bookActionMenu) return;
    if (!visibleBooks.some((book) => book.id === bookActionMenu.book.id)) {
      setBookActionMenu(null);
    }
  }, [bookActionMenu, visibleBooks]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "l"
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="dialog"], [role="listbox"], [role="menu"]')) {
        return;
      }

      const searchInput = searchInputRef.current;
      if (!searchInput || searchInput.disabled) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      searchInput.focus({ preventScroll: true });
      searchInput.select();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  useEffect(() => {
    const availableIds = new Set(bookshelves.map((bookshelf) => bookshelf.id));
    const nextSelectedIds = selectedImportBookshelfIds.filter((bookshelfId) =>
      availableIds.has(bookshelfId),
    );

    if (nextSelectedIds.length === selectedImportBookshelfIds.length) {
      return;
    }

    setSelectedImportBookshelfIds(nextSelectedIds);
  }, [bookshelves, selectedImportBookshelfIds]);

  const onChangeView = useCallback((nextView: BookshelfView) => {
    setView(nextView);
    try {
      localStorage.setItem(BOOKSHELF_VIEW_KEY, nextView);
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const onChangeDensity = useCallback((nextDensity: BookshelfDensity) => {
    setDensity(nextDensity);
    try {
      localStorage.setItem(BOOKSHELF_DENSITY_KEY, nextDensity);
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const onChangeBookshelfSort = useCallback((key: BookshelfSortKey) => {
    setBookshelfSort((current) => getNextBookshelfSort(current, key));
  }, []);

  const onSelectBookshelfSort = useCallback((key: BookshelfSortKey) => {
    setBookshelfSort({ key, direction: getDefaultBookshelfSortDirection(key) });
  }, []);

  const onSelectBookshelf = useCallback(
    (bookshelfId: string) => {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("shelf", bookshelfId);
      if (query.trim()) {
        nextParams.set("q", query.trim());
      } else {
        nextParams.delete("q");
      }
      setSearchParams(nextParams);
    },
    [query, searchParams, setSearchParams],
  );

  const openBookActionMenu = useCallback((book: BookSummary, x: number, y: number) => {
    setBookActionMenu({ book, ...getContextMenuPosition(x, y) });
  }, []);

  const onBookContextMenu = useCallback(
    (book: BookSummary, event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      openBookActionMenu(book, event.clientX, event.clientY);
    },
    [openBookActionMenu],
  );

  const onBookContextKeyDown = useCallback(
    (book: BookSummary, event: ReactKeyboardEvent<HTMLElement>) => {
      if (!isContextMenuKey(event)) return;

      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      openBookActionMenu(book, rect.left + 24, rect.top + 24);
    },
    [openBookActionMenu],
  );

  const onOpenBookActionMenu = useCallback(
    (book: BookSummary, rect: DOMRect) => {
      openBookActionMenu(book, rect.right, rect.bottom + 4);
    },
    [openBookActionMenu],
  );

  const sendBookFromShelf = useEffectEvent(async () => {
    if (!bookPendingSend || sendingBookId || !canSendToKindleFromShelf || !activeBookshelf) return;

    setSendingBookId(bookPendingSend.id);
    setSendError(null);
    setError(null);

    try {
      await api.sendBook(bookPendingSend.id, undefined, activeBookshelf.id);
      setBookPendingSend(null);
      toast({
        title: "Email accepted",
        description:
          "Amazon may still reject it if the sender is not approved.",
        variant: "success",
      });
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Send failed.";
      setSendError(message);
      toast({
        title: "Send failed",
        description: message,
        variant: "error",
      });
    } finally {
      setSendingBookId(null);
    }
  });

  const deleteBookFromShelf = useEffectEvent(async () => {
    if (!bookPendingDelete || deletingBookId) return;

    setDeletingBookId(bookPendingDelete.id);
    setDeleteError(null);

    try {
      const deletion = await api.deleteBook(bookPendingDelete.id);
      setBooks((current) => current.filter((book) => book.id !== bookPendingDelete.id));
      setBookPendingDelete(null);
      await loadBookshelves();
      toast({
        title: "Deleted",
        description: deletion.message,
        variant: "success",
      });
    } catch (requestError) {
      setDeleteError(requestError instanceof Error ? requestError.message : "Delete failed.");
    } finally {
      setDeletingBookId(null);
    }
  });

  const importFiles = useEffectEvent(async (files: File[], bookshelfIds: string[]) => {
    if (files.length === 0 || uploading || bookshelfIds.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      for (let index = 0; index < files.length; index += IMPORT_BATCH_SIZE) {
        const batch = files.slice(index, index + IMPORT_BATCH_SIZE);
        const batchResults = await api.importBooks(batch, bookshelfIds);
        for (const result of batchResults) {
          toast({
            title: getImportToastTitle(result.status),
            description: result.message,
            variant: getImportToastVariant(result.status),
          });
        }
      }

      await loadBooks();
      await loadBookshelves();
    } catch (requestError) {
      toast({
        title: "Import failed",
        description: requestError instanceof Error ? requestError.message : "Import failed.",
        variant: "error",
      });
    } finally {
      setUploading(false);
    }
  });

  const requestImportFiles = useEffectEvent((files: File[]) => {
    if (files.length === 0 || uploading) return;

    if (activeBookshelf) {
      void importFiles(files, [activeBookshelf.id]);
      return;
    }

    const defaultBookshelfIds =
      selectedImportBookshelfIds.length > 0
        ? selectedImportBookshelfIds
        : bookshelves[0]?.id
          ? [bookshelves[0].id]
          : [];
    if (defaultBookshelfIds.length === 0) return;

    setSelectedImportBookshelfIds(defaultBookshelfIds);
    setPendingImportFiles(files);
    setIsImportTargetModalOpen(true);
  });

  const closeImportTargetModal = useCallback(() => {
    if (uploading) return;
    setIsImportTargetModalOpen(false);
    setPendingImportFiles([]);
  }, [uploading]);

  const toggleImportBookshelf = useCallback((bookshelfId: string) => {
    setSelectedImportBookshelfIds((current) =>
      current.includes(bookshelfId)
        ? current.filter((id) => id !== bookshelfId)
        : [...current, bookshelfId],
    );
  }, []);

  const selectAllImportBookshelves = useCallback(() => {
    setSelectedImportBookshelfIds(bookshelves.map((bookshelf) => bookshelf.id));
  }, [bookshelves]);

  const clearImportBookshelves = useCallback(() => {
    setSelectedImportBookshelfIds([]);
  }, []);

  const confirmImportTarget = useCallback(() => {
    if (pendingImportFiles.length === 0 || selectedImportBookshelfIds.length === 0 || uploading) return;

    const files = pendingImportFiles;
    const bookshelfIds = selectedImportBookshelfIds;
    setIsImportTargetModalOpen(false);
    setPendingImportFiles([]);
    void importFiles(files, bookshelfIds);
  }, [importFiles, pendingImportFiles, selectedImportBookshelfIds, uploading]);

  const onDropBookshelfFiles = useEffectEvent((files: File[]) => {
    const importableFiles = getImportableFiles(files);
    if (importableFiles.length === 0) {
      toast({
        title: "Import unavailable",
        description: INVALID_IMPORT_FILES_MESSAGE,
        variant: "error",
      });
      return;
    }

    requestImportFiles(importableFiles);
  });

  const bookshelfDropTarget = useFileDropTarget({
    enabled: !uploading && !isImportModalOpen,
    onDropFiles: onDropBookshelfFiles,
  });

  const showInitialBookshelfSkeleton = loading && !hasLoadedBooks;
  const showEmptyBookshelf = !showInitialBookshelfSkeleton && visibleBooks.length === 0;
  const activeBookMenuItems: OverflowMenuItem[] = bookActionMenu
    ? [
        ...(canSendToKindleFromShelf
          ? [
              {
                id: "send",
                label:
                  sendingBookId === bookActionMenu.book.id ? "Sending\u2026" : "Send to Kindle",
                disabled: sendingBookId !== null || deletingBookId !== null,
                onSelect: () => {
                  setSendError(null);
                  setBookPendingSend(bookActionMenu.book);
                },
              },
            ]
          : []),
        {
          id: "read",
          label: "Read book",
          onSelect: () =>
            openReaderWindow(
              bookActionMenu.book.id,
              getReaderSearch(activeBookshelfId),
            ),
        },
        {
          id: "delete",
          label: "Delete book",
          disabled: sendingBookId !== null || deletingBookId !== null,
          onSelect: () => {
            setDeleteError(null);
            setBookPendingDelete(bookActionMenu.book);
          },
          variant: "destructive",
        },
      ]
    : [];

  return (
    <div
      className={cn(
        "page bookshelf-dropzone-shell",
        showEmptyBookshelf && "bookshelf-dropzone-shell-empty",
      )}
      onDragEnter={bookshelfDropTarget.onDragEnter}
      onDragLeave={bookshelfDropTarget.onDragLeave}
      onDragOver={bookshelfDropTarget.onDragOver}
      onDrop={bookshelfDropTarget.onDrop}
    >
      {bookActionMenu ? (
        <BookActionMenu
          items={activeBookMenuItems}
          onClose={() => setBookActionMenu(null)}
          x={bookActionMenu.x}
          y={bookActionMenu.y}
        />
      ) : null}

      <SendBookModal
        bookTitle={bookPendingSend?.title ?? ""}
        error={sendError}
        onClose={() => {
          if (!sendingBookId) {
            setSendError(null);
            setBookPendingSend(null);
          }
        }}
        onConfirm={() => {
          void sendBookFromShelf();
        }}
        open={bookPendingSend !== null}
        recipientEmail={activeBookshelf?.kindleEmail ?? ""}
        sending={sendingBookId !== null}
      />

      <DeleteBookModal
        bookTitle={bookPendingDelete?.title ?? ""}
        deleting={deletingBookId !== null}
        error={deleteError}
        onClose={() => {
          if (!deletingBookId) {
            setDeleteError(null);
            setBookPendingDelete(null);
          }
        }}
        onConfirm={() => {
          void deleteBookFromShelf();
        }}
        open={bookPendingDelete !== null}
      />

      <div
        aria-hidden={!bookshelfDropTarget.isActive}
        className={cn("bookshelf-dropzone-overlay", bookshelfDropTarget.isActive && "visible")}
      >
        <div className="bookshelf-dropzone-callout">
          <div className="import-dropzone-icon">
            <UploadIcon />
          </div>
          <p className="bookshelf-dropzone-title">Drop EPUBs to import</p>
          <p className="bookshelf-dropzone-copy">
            {activeBookshelf
              ? `Release anywhere on the shelf to add them to ${activeBookshelf.name}.`
              : "Release anywhere on the shelf to choose where they belong."}
          </p>
        </div>
      </div>

      <div
        className={cn(
          "bookshelf-layout bookshelf-dropzone-content",
          bookshelfDropTarget.isActive && "bookshelf-dropzone-content-muted",
        )}
      >
        <BookshelfSidebar
          activeBookshelfId={activeBookshelfId}
          bookshelves={bookshelves}
          totalBookCount={bookshelves.reduce(
            (total, bookshelf) => total + bookshelf.bookCount,
            0,
          )}
          statusFilter={statusFilter}
          statusCounts={statusCounts}
          onSelectBookshelf={onSelectBookshelf}
          onChangeStatusFilter={setStatusFilter}
        />

        <div className="bookshelf-main stack-lg">
          <header className="bookshelf-main-header">
            <div className="bookshelf-main-heading">
              <h1 className="bookshelf-main-title">
                {activeBookshelfId === ALL_BOOKSHELVES_ID
                  ? "All books"
                  : activeBookshelf?.name ?? "Bookshelf"}
              </h1>
              <p className="bookshelf-main-subtitle">
                {numberFormatter.format(books.length)}
                {books.length === 1 ? " book" : " books"}
                {showingFilteredResults
                  ? ` \u00b7 ${numberFormatter.format(visibleBooks.length)} shown`
                  : ""}
              </p>
            </div>
            <div className="bookshelf-header-actions">
              <Button
                disabled={uploading || !canImportBooks}
                onClick={() => setIsImportModalOpen(true)}
                type="button"
              >
                {uploading ? "Importing\u2026" : "Add EPUBs"}
              </Button>
            </div>
          </header>

          {hasLoadedSettings && activeBookshelf && !activeBookshelf.kindleEmail ? (
            <p className="bookshelf-header-note">
              <Link className="bookshelf-header-note-link" to="/settings">
                Add a Kindle address
              </Link>{" "}
              to enable sending books from {activeBookshelf.name}.
            </p>
          ) : null}

        <ImportBooksModal
          disabled={uploading}
          onClose={() => setIsImportModalOpen(false)}
          onImportFiles={(files) => {
            requestImportFiles(files);
          }}
          onRejectFiles={() =>
            toast({
              title: "Import unavailable",
              description: INVALID_IMPORT_FILES_MESSAGE,
              variant: "error",
            })
          }
          open={isImportModalOpen}
        />

        <ImportTargetModal
          bookshelves={bookshelves}
          disabled={uploading}
          fileCount={pendingImportFiles.length}
          onClearBookshelves={clearImportBookshelves}
          onClose={closeImportTargetModal}
          onConfirm={confirmImportTarget}
          onSelectAllBookshelves={selectAllImportBookshelves}
          onToggleBookshelf={toggleImportBookshelf}
          open={isImportTargetModalOpen}
          selectedBookshelfIds={selectedImportBookshelfIds}
        />

        <section className="toolbar">
          <div className="searchbox">
            <Input
              aria-label="Search library"
              autoComplete="off"
              id="library-search"
              inputMode="search"
              name="library_search"
              ref={searchInputRef}
              onChange={(event) => {
                const nextValue = event.currentTarget.value;
                setQuery(nextValue);
                startTransition(() => {
                  const nextParams = new URLSearchParams(searchParams);
                  if (nextValue) {
                    nextParams.set("q", nextValue);
                  } else {
                    nextParams.delete("q");
                  }
                  if (activeBookshelfId) {
                    nextParams.set("shelf", activeBookshelfId);
                  }
                  setSearchParams(nextParams);
                });
              }}
              placeholder={"Search by title, author\u2026"}
              type="search"
              value={query}
            />
          </div>
          <div className="toolbar-actions">
            <Select
              value={bookshelfSort.key}
              onValueChange={(value) => onSelectBookshelfSort(value as BookshelfSortKey)}
            >
              <SelectTrigger
                aria-label="Sort books"
                className="bookshelf-sort-trigger"
              >
                <span className="bookshelf-sort-eyebrow">Sort</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BOOKSHELF_SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <div
              aria-label={view === "grid" ? "Grid density" : "List density"}
              className="view-toggle density-toggle"
              role="group"
            >
              <Button
                aria-pressed={density === "comfortable"}
                className={cn("view-toggle-button", density === "comfortable" && "active")}
                onClick={() => onChangeDensity("comfortable")}
                size="sm"
                title="Comfortable density"
                type="button"
                variant="ghost"
              >
                {view === "list" ? <ListComfortableIcon /> : <DensityComfortableIcon />}
              </Button>
              <Button
                aria-pressed={density === "compact"}
                className={cn("view-toggle-button", density === "compact" && "active")}
                onClick={() => onChangeDensity("compact")}
                size="sm"
                title="Compact density"
                type="button"
                variant="ghost"
              >
                {view === "list" ? <ListCompactIcon /> : <DensityCompactIcon />}
              </Button>
            </div>
          </div>
        </section>

        {error ? <p className="inline-error">{error}</p> : null}

        {showInitialBookshelfSkeleton ? (
          <BookshelfSkeleton view={view} />
        ) : visibleBooks.length === 0 ? (
          <section className="empty-state empty-dropzone stack-sm">
            <div className="empty-dropzone-icon" aria-hidden="true">
              <UploadIcon />
            </div>
            <h2>{showingFilteredResults ? "No matching books" : "No books yet"}</h2>
            <p>
              {showingFilteredResults
                ? "Try a different title, author, or status filter."
                : "Drop .epub files anywhere on this page to add them \u2014 or use the button below."}
            </p>
            {!showingFilteredResults ? (
              <div className="empty-state-actions">
                <Button
                  disabled={uploading || !canImportBooks}
                  onClick={() => setIsImportModalOpen(true)}
                  type="button"
                >
                  {uploading ? "Importing\u2026" : "Add EPUBs"}
                </Button>
              </div>
            ) : (
              <div className="empty-state-actions">
                <Button
                  onClick={() => {
                    setStatusFilter("all");
                    setQuery("");
                    const nextParams = new URLSearchParams(searchParams);
                    nextParams.delete("q");
                    setSearchParams(nextParams);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Clear filters
                </Button>
              </div>
            )}
          </section>
        ) : view === "list" ? (
          <BookshelfList
            books={sortedVisibleBooks}
            bookshelfId={activeBookshelfId}
            density={density}
            onBookContextKeyDown={onBookContextKeyDown}
            onBookContextMenu={onBookContextMenu}
            onChangeSort={onChangeBookshelfSort}
            sort={bookshelfSort}
          />
        ) : (
          <BookshelfGrid
            books={sortedVisibleBooks}
            bookshelfId={activeBookshelfId}
            density={density}
            sortKey={bookshelfSort.key}
            onBookContextKeyDown={onBookContextKeyDown}
            onBookContextMenu={onBookContextMenu}
            onOpenActionMenu={onOpenBookActionMenu}
          />
        )}
        </div>
      </div>
    </div>
  );
};

const BookDetailPage = () => {
  const { bookId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();

  const [book, setBook] = useState<BookDetail | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [bookshelves, setBookshelves] = useState<BookshelfSummary[]>([]);
  const [bookShelfIdsDraft, setBookShelfIdsDraft] = useState<string[]>([]);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [editingRecipient, setEditingRecipient] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingBookShelves, setSavingBookShelves] = useState(false);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [showStickyBar, setShowStickyBar] = useState(false);

  useDocumentTitle(book?.title ? `${book.title} — Irulan` : "Irulan");

  const heroTitleRef = useRef<HTMLHeadingElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);

  const loadBook = useEffectEvent(async () => {
    setLoading(true);
    setError(null);

    try {
      const [nextBook, nextDeliveries, nextSettings, nextBookshelves] = await Promise.all([
        api.getBook(bookId),
        api.getDeliveries(bookId),
        api.getSettings(),
        api.listBookshelves(),
      ]);

      const requestedShelfId = searchParams.get("shelf");
      const defaultBookshelf =
        nextBook.bookshelves.find((bookshelf) => bookshelf.id === requestedShelfId) ??
        nextBook.bookshelves[0] ??
        null;

      setBook(nextBook);
      setDeliveries(nextDeliveries);
      setSettings(nextSettings);
      setBookshelves(nextBookshelves);
      setBookShelfIdsDraft(nextBook.bookshelves.map((bookshelf) => bookshelf.id));
      const defaultEmail = defaultBookshelf?.kindleEmail ?? "";
      setRecipientEmail(defaultEmail);
      setEditingRecipient(defaultEmail.length === 0);
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
    setBookshelves([]);
    setBookShelfIdsDraft([]);
    setRecipientEmail("");
    setEditingRecipient(false);
    setSavingBookShelves(false);
    setSavingMetadata(false);
    setMetadataError(null);
    setDeleteError(null);
    setIsDeleteModalOpen(false);
    setShowStickyBar(false);
    setCopyState("idle");
    void loadBook();
  }, [bookId, searchParams]);

  useEffect(() => {
    const target = heroTitleRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          setShowStickyBar(!entry.isIntersecting);
        }
      },
      { rootMargin: "-72px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [book?.id]);

  const onSend = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (sending || !recipientEmail.trim() || !book) return;

    setSending(true);
    setError(null);

    try {
      const requestedShelfId = searchParams.get("shelf");
      const deliveryBookshelf =
        book.bookshelves.find((bookshelf) => bookshelf.id === requestedShelfId) ??
        book.bookshelves[0] ??
        null;
      const delivery = await api.sendBook(bookId, recipientEmail, deliveryBookshelf?.id ?? null);
      setDeliveries((current) => [delivery, ...current]);
      toast({
        title: "Email accepted",
        description:
          "Amazon may still reject it if the sender is not approved.",
        variant: "success",
      });
      setEditingRecipient(false);
      window.requestAnimationFrame(() => {
        historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (requestError) {
      toast({
        title: "Send failed",
        description: requestError instanceof Error ? requestError.message : "Send failed.",
        variant: "error",
      });
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
      navigate(backHref, {
        replace: true,
        state: { message: deletion.message },
      });
    } catch (requestError) {
      setDeleteError(requestError instanceof Error ? requestError.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  };

  const onCopyFilename = async () => {
    if (!book) return;
    try {
      await navigator.clipboard.writeText(book.sourceFilename);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1800);
  };

  const onToggleBookShelf = (bookshelfId: string) => {
    setBookShelfIdsDraft((current) =>
      current.includes(bookshelfId)
        ? current.filter((id) => id !== bookshelfId)
        : [...current, bookshelfId],
    );
  };

  const onSaveBookShelves = async () => {
    if (!book || savingBookShelves) return;

    if (bookShelfIdsDraft.length === 0) {
      toast({
        title: "Choose a bookshelf",
        description: "A book needs to belong to at least one bookshelf.",
        variant: "error",
      });
      return;
    }

    setSavingBookShelves(true);

    try {
      const updatedBook = await api.saveBookBookshelves(book.id, bookShelfIdsDraft);
      const nextBookshelves = await api.listBookshelves();
      setBook(updatedBook);
      setBookShelfIdsDraft(updatedBook.bookshelves.map((bookshelf) => bookshelf.id));
      setBookshelves(nextBookshelves);
      toast({
        title: "Bookshelves updated",
        description: `${updatedBook.title} shelf membership saved.`,
        variant: "success",
      });
    } catch (requestError) {
      toast({
        title: "Could not update bookshelves",
        description:
          requestError instanceof Error
            ? requestError.message
            : "Could not update bookshelves.",
        variant: "error",
      });
    } finally {
      setSavingBookShelves(false);
    }
  };

  const onSaveBookMetadata = async (metadata: UpdateBookMetadataPayload) => {
    if (!book || savingMetadata) return;

    const nextReadStatus = metadata.readStatus ?? book.readStatus;
    const nextRating = metadata.rating === undefined ? book.rating : metadata.rating;
    if (nextReadStatus === book.readStatus && nextRating === book.rating) return;

    const previousBook = book;
    setBook({
      ...book,
      readStatus: nextReadStatus,
      rating: nextRating,
    });
    setSavingMetadata(true);
    setMetadataError(null);

    try {
      setBook(await api.saveBookMetadata(book.id, metadata));
    } catch (requestError) {
      setBook(previousBook);
      const message =
        requestError instanceof Error ? requestError.message : "Could not save metadata.";
      setMetadataError(message);
      toast({
        title: "Could not save metadata",
        description: message,
        variant: "error",
      });
    } finally {
      setSavingMetadata(false);
    }
  };

  if (loading && !book) {
    return <BookDetailSkeleton />;
  }

  if (!book) {
    return (
      <div className="page page-narrow stack-lg">
        <div className="detail-page-header">
          <Button asChild className="backlink" variant="ghost">
            <Link to={getBookshelfHref(searchParams.get("shelf"))}>
              <ArrowLeftIcon />
              Bookshelf
            </Link>
          </Button>
        </div>
        <section className="empty-state stack-sm">
          <h2>Book unavailable</h2>
          <p>{error ?? "This record could not be loaded."}</p>
        </section>
      </div>
    );
  }

  const requestedShelfId = searchParams.get("shelf");
  const activeBookBookshelf =
    book.bookshelves.find((bookshelf) => bookshelf.id === requestedShelfId) ??
    book.bookshelves[0] ??
    null;
  const navigationBookshelfId = requestedShelfId ?? activeBookBookshelf?.id ?? null;
  const backHref = getBookshelfHref(navigationBookshelfId);
  const smtpReady = Boolean(settings?.smtp.configured);
  const defaultEmail = activeBookBookshelf?.kindleEmail?.trim() ?? "";
  const trimmedRecipient = recipientEmail.trim();
  const hasDefaultEmail = defaultEmail.length > 0;
  const recipientMatchesDefault =
    hasDefaultEmail && trimmedRecipient === defaultEmail;
  const bookShelfMembershipDirty =
    bookShelfIdsDraft.length !== book.bookshelves.length ||
    bookShelfIdsDraft.some((id) => !book.bookshelves.some((bookshelf) => bookshelf.id === id));
  const lastSuccessfulDelivery =
    deliveries.find((delivery) => delivery.status === "sent") ?? null;
  const lastSentAt =
    lastSuccessfulDelivery?.sentAt ?? lastSuccessfulDelivery?.createdAt ?? null;
  const sendDisabled = sending || !smtpReady || trimmedRecipient.length === 0;

  const stickyBarVisible = showStickyBar;
  const showRecipientForm = editingRecipient || trimmedRecipient.length === 0;

  return (
    <>
      <div
        aria-hidden={!stickyBarVisible}
        className={cn("detail-sticky-bar", stickyBarVisible && "visible")}
      >
        <div className="detail-sticky-bar-inner">
          <Link
            aria-label="Back to bookshelf"
            className="detail-sticky-back"
            tabIndex={stickyBarVisible ? 0 : -1}
            to={backHref}
          >
            <ArrowLeftIcon />
          </Link>
          <div className="detail-sticky-text">
            <span className="detail-sticky-title" title={book.title}>
              {book.title}
            </span>
            <span className="detail-sticky-author">{book.author}</span>
          </div>
          <div className="detail-sticky-actions">
            <Button
              onClick={() => openReaderWindow(book.id, getReaderSearch(navigationBookshelfId))}
              size="sm"
              tabIndex={stickyBarVisible ? 0 : -1}
              type="button"
              variant="outline"
            >
              Read
            </Button>
            <Button
              disabled={sendDisabled}
              onClick={() => {
                void onSend();
              }}
              size="sm"
              tabIndex={stickyBarVisible ? 0 : -1}
              type="button"
            >
              {sending ? "Sending\u2026" : "Send to Kindle"}
            </Button>
          </div>
        </div>
      </div>

      <div className="page page-narrow stack-lg">
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

        <div className="detail-page-header">
        <Button asChild className="backlink" variant="ghost">
          <Link to={backHref}>
            <ArrowLeftIcon />
            Bookshelf
          </Link>
        </Button>
      </div>

      <section className="detail-hero">
        <button
          aria-label={`Read ${book.title}`}
          className="detail-cover-clickable"
          onClick={() => openReaderWindow(book.id, getReaderSearch(navigationBookshelfId))}
          type="button"
        >
          <BookCover book={book} large />
          <span className="detail-cover-overlay" aria-hidden="true">
            <span className="detail-cover-overlay-icon">
              <PlayIcon />
            </span>
            <span className="detail-cover-overlay-label">Read</span>
          </span>
        </button>

        <div className="detail-identity stack-md">
          <div className="stack-xs">
            <h2 className="detail-title" ref={heroTitleRef}>
              {book.title}
            </h2>
            <p className="detail-author detail-author-large">{book.author}</p>
            <p className="detail-meta-line">
              <span>EPUB</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(book.fileSizeBytes)}</span>
              <span aria-hidden="true">·</span>
              <span>Imported {formatDate(book.importedAt)}</span>
              {lastSentAt ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    Last sent {formatRelative(lastSentAt) ?? formatDate(lastSentAt)}
                  </span>
                </>
              ) : null}
            </p>
          </div>

          <BookMetadataEditor
            book={book}
            error={metadataError}
            onChange={(metadata) => {
              void onSaveBookMetadata(metadata);
            }}
            saving={savingMetadata}
          />

          <div className="send-card">
            <div className="send-card-header">
              <div className="send-card-title">
                <span aria-hidden="true" className="send-card-icon">
                  <MailIcon />
                </span>
                <span>Send to Kindle</span>
              </div>
              <span
                className={cn(
                  "send-status",
                  smtpReady ? "send-status-ready" : "send-status-warn",
                )}
              >
                <span aria-hidden="true" className="send-status-dot" />
                {smtpReady ? "SMTP ready" : "SMTP not configured"}
              </span>
            </div>

            {showRecipientForm ? (
              <form
                className="send-recipient-form"
                onSubmit={(event) => {
                  void onSend(event);
                }}
              >
                <Label className="sr-only" htmlFor="recipient-email">
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
                {hasDefaultEmail && !recipientMatchesDefault ? (
                  <Button
                    onClick={() => {
                      setRecipientEmail(defaultEmail);
                      setEditingRecipient(false);
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Use shelf
                  </Button>
                ) : hasDefaultEmail ? (
                  <Button
                    onClick={() => setEditingRecipient(false)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                ) : null}
              </form>
            ) : (
              <div className="send-recipient-display">
                <div className="send-recipient-info">
                  <span className="send-recipient-eyebrow">To</span>
                  <span className="send-recipient-email" title={trimmedRecipient}>
                    {trimmedRecipient}
                  </span>
                  {recipientMatchesDefault ? (
                    <span className="send-recipient-tag">
                      {activeBookBookshelf?.name ?? "Shelf"}
                    </span>
                  ) : null}
                </div>
                <Button
                  className="send-recipient-edit"
                  onClick={() => setEditingRecipient(true)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <EditIcon />
                  Change
                </Button>
              </div>
            )}

            <div className="send-card-actions">
              <Button
                disabled={sendDisabled}
                onClick={() => {
                  void onSend();
                }}
                type="button"
              >
                {sending ? "Sending\u2026" : "Send to Kindle"}
              </Button>
              {!smtpReady ? (
                <Button asChild size="sm" variant="ghost">
                  <Link to="/settings">Configure SMTP →</Link>
                </Button>
              ) : null}
            </div>

          </div>

          <Link className="detail-secondary-link" to="/bookshelves">
            Manage bookshelves <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <Card className="panel stack-sm">
        <div className="section-heading">
          <CardTitle>About this book</CardTitle>
        </div>
        <dl className="about-grid">
          <div>
            <dt>Format</dt>
            <dd>EPUB</dd>
          </div>
          <div>
            <dt>File size</dt>
            <dd>{formatBytes(book.fileSizeBytes)}</dd>
          </div>
          <div>
            <dt>Imported</dt>
            <dd>{formatDate(book.importedAt)}</dd>
          </div>
          <div>
            <dt>Read status</dt>
            <dd>
              <ReadStatusBadge status={book.readStatus} />
            </dd>
          </div>
          <div>
            <dt>Rating</dt>
            <dd>
              <RatingStars rating={book.rating} />
            </dd>
          </div>
          <div>
            <dt>Bookshelves</dt>
            <dd>
              <span className="bookshelf-chip-row">
                {book.bookshelves.map((bookshelf) => (
                  <span className="bookshelf-chip" key={bookshelf.id}>
                    {bookshelf.name}
                  </span>
                ))}
              </span>
            </dd>
          </div>
          <div className="about-grid-file-row">
            <dt>Filename</dt>
            <dd>
              <span className="about-grid-filename-value" title={book.sourceFilename}>
                {book.sourceFilename}
              </span>
              <Button
                aria-label={
                  copyState === "copied"
                    ? "Filename copied to clipboard"
                    : "Copy filename to clipboard"
                }
                className="about-grid-copy"
                onClick={() => {
                  void onCopyFilename();
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                <CopyIcon />
                <span>{copyState === "copied" ? "Copied" : "Copy"}</span>
              </Button>
            </dd>
          </div>
          <div>
            <dt>Last sent</dt>
            <dd>
              {lastSentAt
                ? `${formatRelative(lastSentAt) ?? formatDate(lastSentAt)}${
                    lastSuccessfulDelivery?.recipientEmail
                      ? ` \u00b7 ${lastSuccessfulDelivery.recipientEmail}`
                      : ""
                  }`
                : "Never"}
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="panel stack-sm">
        <CardHeader className="section-heading border-b">
          <CardTitle>Bookshelves</CardTitle>
          <span>{numberFormatter.format(bookShelfIdsDraft.length)} selected</span>
        </CardHeader>
        <div className="bookshelf-membership-list">
          {bookshelves.map((bookshelf) => (
            <label className="bookshelf-membership-row" key={bookshelf.id}>
              <input
                checked={bookShelfIdsDraft.includes(bookshelf.id)}
                disabled={savingBookShelves}
                name={`bookshelf_${bookshelf.id}`}
                onChange={() => onToggleBookShelf(bookshelf.id)}
                type="checkbox"
              />
              <span className="bookshelf-membership-copy">
                <span className="bookshelf-membership-name">{bookshelf.name}</span>
                <span className="bookshelf-membership-email">
                  {bookshelf.kindleEmail ?? "No Kindle destination"}
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="inline-actions">
          <Button
            disabled={!bookShelfMembershipDirty || savingBookShelves}
            onClick={onSaveBookShelves}
            type="button"
          >
            {savingBookShelves ? "Saving\u2026" : "Save bookshelves"}
          </Button>
          <Button asChild variant="outline">
            <Link to="/bookshelves">Manage shelves</Link>
          </Button>
        </div>
      </Card>

      <Card className="panel stack-sm" ref={historyRef}>
        <CardHeader className="section-heading border-b">
          <CardTitle>Delivery history</CardTitle>
          <span>
            {deliveries.length === 0
              ? "0 attempts"
              : `${numberFormatter.format(deliveries.length)} ${
                  deliveries.length === 1 ? "attempt" : "attempts"
                }`}
          </span>
        </CardHeader>
        {deliveries.length === 0 ? (
          <div className="history-empty">
            <p className="history-empty-title">No delivery attempts yet</p>
            <p className="history-empty-copy">
              Send this book once to see how Amazon responded. SMTP success only means
              your mail server accepted the message — Amazon can still reject after that.
            </p>
          </div>
        ) : (
          <div className="history-list">
            {deliveries.map((delivery) => {
              const sentAt = delivery.sentAt ?? delivery.createdAt;
              const relative = formatRelative(sentAt);
              const deliveryBookshelfName = delivery.bookshelfId
                ? bookshelves.find((bookshelf) => bookshelf.id === delivery.bookshelfId)?.name
                : null;
              return (
                <article
                  className={cn("history-row", `history-row-${delivery.status}`)}
                  key={delivery.id}
                >
                  <div className="history-row-main">
                    <Badge
                      className={cn("status-pill", `status-${delivery.status}`)}
                      variant={getStatusBadgeVariant(delivery.status)}
                    >
                      {delivery.status}
                    </Badge>
                    <div className="history-row-text">
                      <span className="history-row-recipient">
                        {deliveryBookshelfName
                          ? `${deliveryBookshelfName} · ${delivery.recipientEmail}`
                          : delivery.recipientEmail}
                      </span>
                      <span className="history-row-time" title={formatDate(sentAt)}>
                        {relative ?? formatDate(sentAt)}
                      </span>
                    </div>
                  </div>
                  {delivery.errorMessage ? (
                    <p className="history-row-error">{delivery.errorMessage}</p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="panel danger-zone-card">
        <div className="danger-zone-content">
          <div className="stack-xs">
            <p className="eyebrow danger-zone-eyebrow">Danger zone</p>
            <p className="danger-zone-copy">
              Permanently remove this EPUB and its delivery history. This cannot be
              undone.
            </p>
          </div>
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
      </Card>
      </div>
    </>
  );
};

const parseReaderMarkup = (markup: string): Document => {
  let document = new DOMParser().parseFromString(markup, "application/xhtml+xml");
  if (document.querySelector("parsererror")) {
    document = new DOMParser().parseFromString(markup, "text/html");
  }
  return document;
};

const resolveReaderSectionLabels = (
  sections: BookReaderSection[],
  bookTitle: string,
): string[] => {
  const fullTitle = bookTitle.trim().toLocaleLowerCase();
  // Lead segment before a subtitle separator, e.g. "The Coldest Winter: America…"
  // → "the coldest winter". Many EPUBs label every spine item with this.
  const titleLead = bookTitle.split(/[:—–-]/)[0]?.trim().toLocaleLowerCase() ?? fullTitle;

  return sections.map((section, index) => {
    const raw = section.label?.trim() ?? "";
    const normalized = raw.toLocaleLowerCase();
    const previousNormalized =
      index > 0 ? sections[index - 1].label?.trim().toLocaleLowerCase() ?? "" : "";
    const isGeneric =
      !raw ||
      normalized === fullTitle ||
      normalized === titleLead ||
      normalized === previousNormalized;
    return isGeneric ? `Section ${index + 1}` : raw;
  });
};

const ReaderPage = () => {
  const { bookId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const readerViewportRef = useRef<HTMLDivElement | null>(null);
  const readerBodyRef = useRef<HTMLElement | null>(null);
  const sectionMarkupCache = useRef(new Map<string, string>());
  const latestSectionRequest = useRef(0);

  const [reader, setReader] = useState<BookReader | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectionDocument, setSectionDocument] = useState<Document | null>(null);
  // Href of the section currently shown by sectionDocument. Updated atomically
  // with the document so the displayed chapter never lags the URL during loads.
  const [displayedHref, setDisplayedHref] = useState<string | null>(null);
  const [sectionTitle, setSectionTitle] = useState<string | null>(null);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [pageSpan, setPageSpan] = useState(0);
  // Transform of the on-screen chapter, held steady while a new chapter loads
  // so the outgoing one doesn't snap back to its start mid-fetch.
  const frozenOffsetRef = useRef(0);
  const [tone, setTone] = useState<ReaderTone>(() => getStoredReaderTone() ?? "paper");
  const [fontScale, setFontScale] = useState(() => getStoredReaderFontScale() ?? 1);
  // Which immersive (popout) popover is open, if any.
  const [readerPanel, setReaderPanel] = useState<null | "contents" | "appearance">(null);

  const selectedHref = searchParams.get("section")?.trim() ?? "";
  const anchorId = searchParams.get("anchor")?.trim() ?? null;
  const readerBookshelfId = searchParams.get("shelf");
  const bookDetailHref = getBookHref(bookId, readerBookshelfId);
  const isPopout = searchParams.get("popout") === "1";
  const currentPage = Math.max(
    1,
    Number.parseInt(searchParams.get("page") ?? "1", 10) || 1,
  );
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
  const sectionLabels = useMemo(
    () => (reader ? resolveReaderSectionLabels(reader.sections, reader.title) : []),
    [reader],
  );
  const activeSectionLabel =
    sectionTitle ??
    (currentSectionIndex >= 0 ? sectionLabels[currentSectionIndex] : activeSection?.label) ??
    reader?.title ??
    "Reader";
  const readerStyle = {
    "--reader-font-scale": `${fontScale}`,
  } as CSSProperties;
  const currentPageIndex = Math.min(Math.max(0, currentPage - 1), Math.max(0, pageCount - 1));
  const pageOffset = pageSpan > 0 ? currentPageIndex * pageSpan : 0;

  // While a new (uncached) chapter is fetching, the displayed document still
  // belongs to the previous section. Hold it steady at its last offset so it
  // doesn't snap; the atomic swap in loadSection then remounts the new chapter.
  const isSwappingSection =
    sectionDocument !== null && displayedHref !== null && displayedHref !== activeSection?.href;
  const displayedOffset = isSwappingSection ? frozenOffsetRef.current : pageOffset;
  // The section the on-screen document belongs to (the previous one mid-swap).
  const displayedSection =
    (displayedHref
      ? reader?.sections.find((section) => section.href === displayedHref)
      : null) ?? activeSection;

  useEffect(() => {
    if (!isSwappingSection) {
      frozenOffsetRef.current = pageOffset;
    }
  }, [isSwappingSection, pageOffset]);

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
        page?: number | null;
        replace?: boolean;
      } = {},
    ) => {
      if (!href) return;

      const params = new URLSearchParams();
      params.set("section", href);
      if (readerBookshelfId) {
        params.set("shelf", readerBookshelfId);
      }
      if (isPopout) {
        params.set("popout", "1");
      }

      if (options.anchor) {
        params.set("anchor", options.anchor);
      }

      if (typeof options.page === "number" && Number.isFinite(options.page)) {
        params.set("page", String(Math.max(1, Math.round(options.page))));
      } else if (!options.anchor) {
        params.set("page", "1");
      }

      startTransition(() => {
        setSearchParams(params, { replace: options.replace });
      });
    },
    [isPopout, readerBookshelfId, setSearchParams],
  );

  const goToPage = useCallback(
    (
      nextPage: number,
      options: {
        preserveAnchor?: boolean;
        replace?: boolean;
      } = {},
    ) => {
      if (!activeSection?.href) return;

      const params = new URLSearchParams();
      params.set("section", activeSection.href);
      params.set("page", String(Math.max(1, Math.round(nextPage))));
      if (readerBookshelfId) {
        params.set("shelf", readerBookshelfId);
      }
      if (isPopout) {
        params.set("popout", "1");
      }

      if (options.preserveAnchor && anchorId) {
        params.set("anchor", anchorId);
      }

      startTransition(() => {
        setSearchParams(params, { replace: options.replace });
      });
    },
    [activeSection?.href, anchorId, isPopout, readerBookshelfId, setSearchParams],
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

      const nextDocument = parseReaderMarkup(markup);

      if (requestId !== latestSectionRequest.current) {
        return;
      }

      setSectionDocument(nextDocument);
      setDisplayedHref(section.href);
      setSectionTitle(getReaderDocumentTitle(nextDocument));
    } catch (requestError) {
      if (requestId !== latestSectionRequest.current) {
        return;
      }

      setSectionDocument(null);
      setDisplayedHref(null);
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
    setSectionError(null);

    if (!activeSection) {
      setSectionDocument(null);
      setDisplayedHref(null);
      setSectionTitle(null);
      setSectionLoading(false);
      setPageCount(1);
      setPageSpan(0);
      return;
    }

    // Synchronous path for already-fetched chapters: parse and swap in the
    // same commit so we never flash the skeleton between sections. Bump the
    // request id so any in-flight fetch for a prior section is discarded.
    const cachedMarkup = sectionMarkupCache.current.get(activeSection.href);
    if (cachedMarkup) {
      latestSectionRequest.current += 1;
      const nextDocument = parseReaderMarkup(cachedMarkup);
      setSectionDocument(nextDocument);
      setDisplayedHref(activeSection.href);
      setSectionTitle(getReaderDocumentTitle(nextDocument));
      setSectionLoading(false);
      return;
    }

    // Uncached: keep the current chapter on screen (frozen via frozenOffsetRef)
    // while we fetch the new one, then swap atomically in loadSection. The
    // skeleton only appears on the very first load, when there's nothing yet to
    // hold in place. We deliberately do NOT null the document or reset
    // pagination here, so the outgoing chapter stays put during the fetch.
    void loadSection(activeSection);
  }, [activeSection?.href, activeSection?.url]);

  const measurePagination = useEffectEvent(() => {
    const viewport = readerViewportRef.current;
    const body = readerBodyRef.current;
    if (!viewport || !body) {
      setPageCount(1);
      setPageSpan(0);
      return;
    }

    body.style.setProperty("--reader-page-width", `${viewport.clientWidth}px`);

    const columnGap = Number.parseFloat(window.getComputedStyle(body).columnGap || "0");
    const nextPageSpan = viewport.clientWidth + columnGap;
    const nextPageCount =
      nextPageSpan > 0 ? Math.max(1, Math.ceil((body.scrollWidth + columnGap) / nextPageSpan)) : 1;

    setPageSpan(nextPageSpan);
    setPageCount(nextPageCount);
  });

  // Measure synchronously before the browser paints the new section so the
  // column width is correct on the first frame. A post-paint effect would let
  // the content render at the fallback column width and then reflow — the
  // visible "flash" when changing chapters.
  useLayoutEffect(() => {
    if (!sectionDocument || sectionLoading) {
      return;
    }

    measurePagination();

    const viewport = readerViewportRef.current;
    const body = readerBodyRef.current;
    if (!viewport || !body) {
      return;
    }

    const observer = new ResizeObserver(() => {
      measurePagination();
    });

    observer.observe(viewport);
    observer.observe(body);

    return () => {
      observer.disconnect();
    };
  }, [fontScale, sectionDocument, sectionLoading]);

  useEffect(() => {
    if (!activeSection?.href) {
      return;
    }

    if (sectionLoading || pageSpan <= 0) {
      return;
    }

    const clampedPage = Math.max(1, Math.min(currentPage, pageCount));
    if (clampedPage !== currentPage) {
      goToPage(clampedPage, { preserveAnchor: true, replace: true });
    }
  }, [activeSection?.href, currentPage, goToPage, pageCount, pageSpan, sectionLoading]);

  useEffect(() => {
    if (sectionLoading || pageSpan <= 0) {
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
          const rootBounds = root.getBoundingClientRect();
          const targetBounds = anchorTarget.getBoundingClientRect();
          const absoluteLeft = targetBounds.left - rootBounds.left + pageOffset;
          const nextPage = Math.max(1, Math.floor(absoluteLeft / pageSpan) + 1);

          if (nextPage !== currentPage) {
            goToPage(nextPage, { preserveAnchor: true, replace: true });
            return;
          }

          return;
        }
      }

      if (currentPage !== 1) {
        return;
      }

      window.scrollTo({ top: 0, behavior: "auto" });
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [anchorId, currentPage, goToPage, pageOffset, pageSpan, sectionDocument, sectionLoading]);

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

  const onTurnPage = useCallback(
    (direction: "previous" | "next") => {
      if (direction === "previous") {
        if (currentPage > 1) {
          goToPage(currentPage - 1);
          return;
        }

        if (previousSection) {
          goToSection(previousSection.href, { page: 1 });
        }
        return;
      }

      if (currentPage < pageCount) {
        goToPage(currentPage + 1);
        return;
      }

      if (nextSection) {
        goToSection(nextSection.href, { page: 1 });
      }
    },
    [currentPage, goToPage, goToSection, nextSection, pageCount, previousSection],
  );

  const handleReaderShortcut = useCallback(
    (key: string) => {
      if (key === "ArrowRight" || key === "PageDown" || key === " ") {
        onTurnPage("next");
        return true;
      }

      if (key === "ArrowLeft" || key === "PageUp") {
        onTurnPage("previous");
        return true;
      }

      if (key === "Home") {
        goToPage(1, { preserveAnchor: false });
        return true;
      }

      if (key === "End") {
        goToPage(pageCount, { preserveAnchor: false });
        return true;
      }

      return false;
    },
    [goToPage, onTurnPage, pageCount],
  );

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      const target =
        event.target instanceof HTMLElement || event.target instanceof SVGElement
          ? event.target
          : null;
      if (
        target?.closest(
          'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="combobox"], [role="dialog"], [role="link"], [role="listbox"], [role="menu"], [role="textbox"]',
        )
      ) {
        return;
      }

      if (target instanceof HTMLElement && target.isContentEditable) {
        return;
      }

      if (handleReaderShortcut(event.key)) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [handleReaderShortcut]);

  useEffect(() => {
    if (!readerPanel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReaderPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readerPanel]);

  const onReaderViewportKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (handleReaderShortcut(event.key)) {
        event.preventDefault();
      }
    },
    [handleReaderShortcut],
  );

  if (loading && !reader) {
    return (
      <div className="page stack-lg">
        <Button asChild className="backlink" variant="ghost">
          <Link to={bookDetailHref}>
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
          <Link to={bookDetailHref}>
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

  const prevDisabled = currentPage === 1 && !previousSection;
  const nextDisabled = currentPage >= pageCount && !nextSection;

  const renderTocNav = (onAfterSelect?: () => void) => (
    <nav aria-label="Table of contents" className="reader-toc">
      {reader.sections.map((section, index) => (
        <Button
          aria-current={section.href === activeSection?.href ? "page" : undefined}
          className={cn(
            "reader-toc-item",
            section.href === activeSection?.href && "active",
          )}
          key={section.id}
          onClick={() => {
            goToSection(section.href);
            onAfterSelect?.();
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span className="reader-toc-index">{index + 1}</span>
          <span className="reader-toc-label">{sectionLabels[index] ?? section.label}</span>
        </Button>
      ))}
    </nav>
  );

  const toneToggle = (
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
          {option === "paper" ? "Paper" : option === "sepia" ? "Sepia" : "Night"}
        </Button>
      ))}
    </div>
  );

  const fontToggle = (
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
  );

  // The reading surface (tinted ground + floating page + paginated body) is
  // identical in both layouts — only the surrounding chrome differs.
  const readingSurface = (
    <div
      className={cn("reader-canvas", isPopout && "reader-canvas-immersive")}
      data-reader-tone={tone}
      style={readerStyle}
    >
      <div className="reader-paper">
        {sectionError ? <p className="inline-error">{sectionError}</p> : null}

        {!sectionDocument || !displayedSection ? (
          activeSection && !sectionError ? (
            <div aria-hidden="true" className="reader-loading stack-sm">
              {Array.from({ length: 9 }, (_, index) => (
                <SkeletonLine
                  className={index === 0 ? "skeleton-line-heading" : "skeleton-line-paragraph"}
                  key={`reader-body-skeleton-${index}`}
                />
              ))}
            </div>
          ) : !sectionError ? (
            <div className="empty-state stack-sm">
              <h2>No readable sections</h2>
              <p>This EPUB does not include any linear spine items to display.</p>
            </div>
          ) : null
        ) : (
          <div
            aria-label={`Reading viewport, page ${currentPageIndex + 1} of ${pageCount}`}
            className={cn(
              "reader-page-window",
              isSwappingSection && "reader-page-window-loading",
            )}
            onKeyDown={onReaderViewportKeyDown}
            ref={readerViewportRef}
            tabIndex={0}
          >
            <article
              className="reader-body reader-body-paginated"
              key={displayedSection.href}
              onLoadCapture={() => {
                measurePagination();
              }}
              ref={readerBodyRef}
              style={{
                transform: `translate3d(-${displayedOffset}px, 0, 0)`,
              }}
            >
              {renderReaderDocument({
                bookId,
                document: sectionDocument,
                onInternalLinkClick: onInternalReaderLinkClick,
                section: displayedSection,
              })}
            </article>
          </div>
        )}
      </div>
    </div>
  );

  // ─── Immersive layout (popped-out window) ───
  // The page owns the window; Contents and Appearance live in popovers, page
  // turns happen at the edges, and progress sits quietly at the bottom.
  if (isPopout) {
    return (
      <div className="reader-immersive" data-reader-tone={tone}>
        <header className="reader-immersive-bar">
          <div className="reader-immersive-bar-group">
            <button
              aria-expanded={readerPanel === "contents"}
              aria-haspopup="dialog"
              aria-label="Contents"
              className={cn("reader-immersive-control", readerPanel === "contents" && "active")}
              onClick={() => setReaderPanel((panel) => (panel === "contents" ? null : "contents"))}
              type="button"
            >
              <ContentsIcon />
            </button>
          </div>

          <span className="reader-immersive-title">{reader.title}</span>

          <div className="reader-immersive-bar-group reader-immersive-bar-trail">
            <button
              aria-expanded={readerPanel === "appearance"}
              aria-haspopup="dialog"
              aria-label="Appearance"
              className={cn(
                "reader-immersive-control reader-immersive-control-aa",
                readerPanel === "appearance" && "active",
              )}
              onClick={() =>
                setReaderPanel((panel) => (panel === "appearance" ? null : "appearance"))
              }
              type="button"
            >
              Aa
            </button>
          </div>
        </header>

        <div className="reader-immersive-stage">
          <button
            aria-label="Previous page"
            className="reader-edge reader-edge-prev"
            disabled={prevDisabled}
            onClick={() => onTurnPage("previous")}
            type="button"
          >
            <ChevronLeftIcon />
          </button>

          {readingSurface}

          <button
            aria-label="Next page"
            className="reader-edge reader-edge-next"
            disabled={nextDisabled}
            onClick={() => onTurnPage("next")}
            type="button"
          >
            <ChevronRightIcon />
          </button>
        </div>

        <footer className="reader-immersive-footer">
          <span className="reader-immersive-page">
            Page {numberFormatter.format(currentPageIndex + 1)} of {numberFormatter.format(pageCount)}
          </span>
        </footer>

        {error ? <p className="inline-error reader-immersive-error">{error}</p> : null}

        {readerPanel ? (
          <>
            <button
              aria-label="Close menu"
              className="reader-immersive-scrim"
              onClick={() => setReaderPanel(null)}
              type="button"
            />
            {readerPanel === "contents" ? (
              <div
                aria-label="Contents"
                className="reader-immersive-panel reader-immersive-panel-contents"
                role="dialog"
              >
                <div className="reader-immersive-panel-head stack-xs">
                  <p className="eyebrow">Contents</p>
                  <p className="reader-immersive-panel-title">{reader.title}</p>
                  <p className="detail-author">{reader.author}</p>
                </div>
                {renderTocNav(() => setReaderPanel(null))}
              </div>
            ) : (
              <div
                aria-label="Appearance"
                className="reader-immersive-panel reader-immersive-panel-appearance"
                role="dialog"
              >
                <div className="reader-immersive-field">
                  <span className="reader-immersive-field-label">Theme</span>
                  {toneToggle}
                </div>
                <div className="reader-immersive-field">
                  <span className="reader-immersive-field-label">Text size</span>
                  {fontToggle}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    );
  }

  // ─── Standard in-window layout ───
  return (
    <div className="page stack-lg">
      <Button asChild className="backlink" variant="ghost">
        <Link to={bookDetailHref}>
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

          <p className="eyebrow reader-toc-eyebrow">Contents</p>
          {renderTocNav()}
        </Card>

        <section className="reader-content">
          <div className="reader-toolbar">
            <div className="reader-toolbar-nav">
              <Button
                aria-keyshortcuts="ArrowLeft"
                disabled={prevDisabled}
                onClick={() => onTurnPage("previous")}
                title="Previous page (Left arrow)"
                type="button"
                variant="outline"
              >
                Previous page
              </Button>
              <Button
                aria-keyshortcuts="ArrowRight"
                disabled={nextDisabled}
                onClick={() => onTurnPage("next")}
                title="Next page (Right arrow)"
                type="button"
                variant="outline"
              >
                Next page
              </Button>
            </div>

            <div className="reader-toolbar-status">
              <strong className="reader-current-label">{activeSectionLabel}</strong>
              <span className="reader-page-status">
                Page {numberFormatter.format(currentPageIndex + 1)} of{" "}
                {numberFormatter.format(pageCount)}
              </span>
            </div>

            <div className="reader-toolbar-controls">
              {toneToggle}
              {fontToggle}
            </div>
          </div>

          {readingSurface}
        </section>
      </section>
    </div>
  );
};

const SettingsPage = () => {
  useDocumentTitle("Settings \u2014 Irulan");
  const toast = useToast();

  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [bookshelves, setBookshelves] = useState<BookshelfSummary[]>([]);
  const [smtpForm, setSmtpForm] = useState<SmtpFormState>({
    host: "",
    port: "587",
    secure: false,
    user: "",
    pass: "",
    from: "",
  });
  const [loading, setLoading] = useState(true);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadSettings = useEffectEvent(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const [payload, nextBookshelves] = await Promise.all([
        api.getSettings(),
        api.listBookshelves(),
      ]);
      setSettings(payload);
      setBookshelves(nextBookshelves);
      setSmtpForm(toSmtpFormState(payload.smtp));
    } catch (requestError) {
      setLoadError(
        requestError instanceof Error ? requestError.message : "Could not load settings.",
      );
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void loadSettings();
  }, []);

  const onSaveSmtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingSmtp(true);

    const nextPort = Number.parseInt(smtpForm.port.trim(), 10);
    if (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) {
      setSavingSmtp(false);
      toast({
        title: "Invalid SMTP port",
        description: "SMTP port must be a whole number between 1 and 65535.",
        variant: "error",
      });
      return;
    }

    try {
      const payload = await api.saveSmtpSettings({
        host: smtpForm.host.trim(),
        port: nextPort,
        secure: smtpForm.secure,
        user: smtpForm.user.trim(),
        pass: smtpForm.pass,
        from: smtpForm.from.trim(),
      });
      setSettings(payload);
      setSmtpForm(toSmtpFormState(payload.smtp));
      toast({
        title: "SMTP settings saved",
        description: payload.smtp.configured
          ? "SMTP settings saved."
          : "Add at least a host and sender address to finish setup.",
        variant: payload.smtp.configured ? "success" : "warning",
      });
    } catch (requestError) {
      toast({
        title: "Could not save SMTP",
        description:
          requestError instanceof Error
            ? requestError.message
            : "Could not save SMTP settings.",
        variant: "error",
      });
    } finally {
      setSavingSmtp(false);
    }
  };

  if (loading && !settings) {
    return <SettingsSkeleton />;
  }

  const smtpConfigured = Boolean(settings?.smtp.configured);
  const smtpSender = settings?.smtp.from.trim() || null;
  const hasAnyKindleEmail = bookshelves.some((bookshelf) => bookshelf.kindleEmail?.trim());
  const normalizedSmtpPort = Number.parseInt(smtpForm.port.trim(), 10);
  const smtpDirty = Boolean(
    settings &&
      (smtpForm.host.trim() !== settings.smtp.host ||
        (!Number.isInteger(normalizedSmtpPort) || normalizedSmtpPort !== settings.smtp.port) ||
        smtpForm.secure !== settings.smtp.secure ||
        smtpForm.user.trim() !== settings.smtp.user ||
        smtpForm.pass !== settings.smtp.pass ||
        smtpForm.from.trim() !== settings.smtp.from),
  );

  return (
    <div className="page page-narrow stack-lg">
      <Button asChild className="backlink" variant="ghost">
        <Link to="/">
          <ArrowLeftIcon />
          Back to bookshelf
        </Link>
      </Button>

      {loadError ? <p className="inline-error">{loadError}</p> : null}

      <Card className="panel stack-md">
        <div className="stack-xs">
          <h2>Send to Kindle setup</h2>
          <p className="lede">
            Irulan emails EPUBs through your SMTP provider, then Amazon decides whether the
            message is allowed to reach your Kindle library.
          </p>
        </div>

        <div className="smtp-onboarding-grid">
          <div className="smtp-onboarding-callout stack-xs">
            <p className="smtp-onboarding-eyebrow">What Amazon checks</p>
            <p className="smtp-onboarding-copy">
              Amazon must see the exact sender address from <code>SMTP_FROM</code>. Add that
              address to your approved personal document sender list before you test delivery.
            </p>
          </div>
          <div className="smtp-onboarding-callout stack-xs">
            <p className="smtp-onboarding-eyebrow">What most SMTP providers expect</p>
            <p className="smtp-onboarding-copy">
              Port <code>587</code> usually goes with <code>SMTP_SECURE=false</code>. Port{" "}
              <code>465</code> usually goes with <code>SMTP_SECURE=true</code>. Many providers
              require an app password instead of your normal mailbox password.
            </p>
          </div>
        </div>

        <ol className="smtp-onboarding-steps">
          <li className="smtp-onboarding-step">
            <span aria-hidden="true" className="smtp-onboarding-step-number">
              1
            </span>
            <div className="stack-xs">
              <div className="smtp-onboarding-step-heading">
                <p className="smtp-onboarding-step-title">Save your SMTP connection in Irulan</p>
                <Badge
                  className={cn("status-pill", smtpConfigured ? "status-sent" : "status-failed")}
                  variant={getStatusBadgeVariant(smtpConfigured ? "configured" : "missing")}
                >
                  {smtpConfigured ? "Ready" : "Needs SMTP"}
                </Badge>
              </div>
              <p className="smtp-onboarding-step-copy">
                Use the SMTP form below to set the server, port, security mode, optional auth, and
                sender address. Irulan uses the saved values immediately after you press save.
              </p>
            </div>
          </li>
          <li className="smtp-onboarding-step">
            <span aria-hidden="true" className="smtp-onboarding-step-number">
              2
            </span>
            <div className="stack-xs">
              <div className="smtp-onboarding-step-heading">
                <p className="smtp-onboarding-step-title">Approve the sender in Amazon</p>
                <Badge className="status-pill status-pending" variant="outline">
                  Manual step
                </Badge>
              </div>
              <p className="smtp-onboarding-step-copy">
                In Amazon Kindle settings, add{" "}
                <code>{smtpSender ?? "the address from SMTP_FROM"}</code> to the Approved Personal
                Document E-mail List. SMTP success only means your mail server accepted the
                message. Amazon can still reject it after that.
              </p>
            </div>
          </li>
          <li className="smtp-onboarding-step">
            <span aria-hidden="true" className="smtp-onboarding-step-number">
              3
            </span>
            <div className="stack-xs">
              <div className="smtp-onboarding-step-heading">
                <p className="smtp-onboarding-step-title">Create bookshelves and send tests</p>
                <Badge
                  className={cn(
                    "status-pill",
                    hasAnyKindleEmail ? "status-sent" : "status-pending",
                  )}
                  variant={getStatusBadgeVariant(hasAnyKindleEmail ? "configured" : "pending")}
                >
                  {hasAnyKindleEmail ? "Ready" : "Needs address"}
                </Badge>
              </div>
              <p className="smtp-onboarding-step-copy">
                Save a Kindle destination on each bookshelf that should send books to a device,
                then send a test email from the bookshelf page.
              </p>
              {hasAnyKindleEmail ? (
                <p className="smtp-onboarding-step-meta">
                  {numberFormatter.format(bookshelves.filter((bookshelf) => bookshelf.kindleEmail).length)}{" "}
                  shelves have Kindle destinations.
                </p>
              ) : null}
              <Button asChild size="sm" variant="outline">
                <Link to="/bookshelves">Open bookshelves</Link>
              </Button>
            </div>
          </li>
        </ol>

        <p className="smtp-onboarding-note">
          If saving works but sending still fails, the usual causes are the wrong port, the wrong
          TLS mode, or a provider that expects an app password instead of your normal mailbox
          password.
        </p>
      </Card>

      <Card className="panel stack-md">
        <div className="stack-xs">
          <div className="section-heading">
            <h2>SMTP connection</h2>
            <Badge
              className={cn("status-pill", smtpConfigured ? "status-sent" : "status-failed")}
              variant={getStatusBadgeVariant(smtpConfigured ? "configured" : "missing")}
            >
              {smtpConfigured ? "Configured" : "Not configured"}
            </Badge>
          </div>
          <p className="lede">
            Store the mail server Irulan should use for Send to Kindle. If these values are
            currently coming from the environment, saving here overrides them for this library.
          </p>
        </div>

        <form className="stack-md" onSubmit={onSaveSmtp}>
          <div className="settings-form-grid">
            <div className="stack-xs">
              <Label className="field-label" htmlFor="smtp-host">
                SMTP host
              </Label>
              <Input
                autoComplete="url"
                id="smtp-host"
                name="smtp_host"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setSmtpForm((current) => ({ ...current, host: value }));
                }}
                placeholder="smtp.example.com"
                spellCheck={false}
                type="text"
                value={smtpForm.host}
              />
            </div>
            <div className="stack-xs">
              <Label className="field-label" htmlFor="smtp-port">
                SMTP port
              </Label>
              <Input
                id="smtp-port"
                inputMode="numeric"
                name="smtp_port"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setSmtpForm((current) => ({ ...current, port: value }));
                }}
                placeholder="587"
                spellCheck={false}
                type="text"
                value={smtpForm.port}
              />
            </div>
            <div className="stack-xs">
              <Label className="field-label" htmlFor="smtp-security">
                Security mode
              </Label>
              <Select
                onValueChange={(value) =>
                  setSmtpForm((current) => ({ ...current, secure: value === "true" }))
                }
                value={smtpForm.secure ? "true" : "false"}
              >
                <SelectTrigger className="w-full" id="smtp-security">
                  <SelectValue placeholder="Choose a security mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">STARTTLS or opportunistic TLS</SelectItem>
                  <SelectItem value="true">Direct TLS / SSL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="stack-xs">
              <Label className="field-label" htmlFor="smtp-user">
                Username
              </Label>
              <Input
                autoComplete="username"
                id="smtp-user"
                name="smtp_user"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setSmtpForm((current) => ({ ...current, user: value }));
                }}
                placeholder="sender@example.com"
                spellCheck={false}
                type="text"
                value={smtpForm.user}
              />
            </div>
            <div className="stack-xs">
              <Label className="field-label" htmlFor="smtp-pass">
                Password or app password
              </Label>
              <Input
                autoComplete="current-password"
                id="smtp-pass"
                name="smtp_pass"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setSmtpForm((current) => ({ ...current, pass: value }));
                }}
                placeholder="Required by many providers"
                spellCheck={false}
                type="password"
                value={smtpForm.pass}
              />
            </div>
            <div className="stack-xs">
              <Label className="field-label" htmlFor="smtp-from">
                Sender address
              </Label>
              <Input
                autoComplete="email"
                id="smtp-from"
                name="smtp_from"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setSmtpForm((current) => ({ ...current, from: value }));
                }}
                placeholder="sender@example.com"
                spellCheck={false}
                type="email"
                value={smtpForm.from}
              />
            </div>
          </div>

          <p className="smtp-onboarding-step-meta">
            Leave username and password blank only if your SMTP server accepts mail without auth.
            Amazon should see the sender address from this form.
          </p>

          <div className="inline-actions">
            <Button disabled={savingSmtp || !smtpDirty} type="submit">
              {savingSmtp ? "Saving\u2026" : "Save SMTP"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

const BookshelvesPage = () => {
  useDocumentTitle("Bookshelves \u2014 Irulan");
  const toast = useToast();

  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [bookshelves, setBookshelves] = useState<BookshelfSummary[]>([]);
  const [bookshelfForms, setBookshelfForms] = useState<Record<string, BookshelfFormState>>({});
  const [newBookshelf, setNewBookshelf] = useState<BookshelfFormState>({
    name: "",
    kindleEmail: "",
  });
  const [loading, setLoading] = useState(true);
  const [savingBookshelfId, setSavingBookshelfId] = useState<string | null>(null);
  const [deletingBookshelfId, setDeletingBookshelfId] = useState<string | null>(null);
  const [creatingBookshelf, setCreatingBookshelf] = useState(false);
  const [testingBookshelfId, setTestingBookshelfId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadBookshelvesPage = useEffectEvent(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const [payload, nextBookshelves] = await Promise.all([
        api.getSettings(),
        api.listBookshelves(),
      ]);
      setSettings(payload);
      setBookshelves(nextBookshelves);
      setBookshelfForms(toBookshelfFormMap(nextBookshelves));
    } catch (requestError) {
      setLoadError(
        requestError instanceof Error ? requestError.message : "Could not load bookshelves.",
      );
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void loadBookshelvesPage();
  }, []);

  const refreshBookshelves = async () => {
    const nextBookshelves = await api.listBookshelves();
    setBookshelves(nextBookshelves);
    setBookshelfForms(toBookshelfFormMap(nextBookshelves));
    return nextBookshelves;
  };

  const onSaveBookshelf = async (bookshelfId: string) => {
    const form = bookshelfForms[bookshelfId];
    if (!form || savingBookshelfId) return;

    setSavingBookshelfId(bookshelfId);

    try {
      await api.updateBookshelf(bookshelfId, form.name.trim(), form.kindleEmail.trim() || null);
      await refreshBookshelves();
      toast({
        title: "Bookshelf saved",
        description: "Bookshelf settings saved.",
        variant: "success",
      });
    } catch (requestError) {
      toast({
        title: "Could not save bookshelf",
        description:
          requestError instanceof Error ? requestError.message : "Could not save bookshelf.",
        variant: "error",
      });
    } finally {
      setSavingBookshelfId(null);
    }
  };

  const onCreateBookshelf = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreatingBookshelf(true);

    try {
      const created = await api.createBookshelf(
        newBookshelf.name.trim(),
        newBookshelf.kindleEmail.trim() || null,
      );
      await refreshBookshelves();
      setNewBookshelf({ name: "", kindleEmail: "" });
      toast({
        title: "Bookshelf created",
        description: `${created.name} is ready.`,
        variant: "success",
      });
    } catch (requestError) {
      toast({
        title: "Could not create bookshelf",
        description:
          requestError instanceof Error ? requestError.message : "Could not create bookshelf.",
        variant: "error",
      });
    } finally {
      setCreatingBookshelf(false);
    }
  };

  const onDeleteBookshelf = async (bookshelf: BookshelfSummary) => {
    if (deletingBookshelfId) return;
    const confirmed = window.confirm(
      `Remove "${bookshelf.name}"? Books remain in the shared library.`,
    );
    if (!confirmed) return;

    setDeletingBookshelfId(bookshelf.id);

    try {
      const deletion = await api.deleteBookshelf(bookshelf.id);
      await refreshBookshelves();
      toast({
        title: "Bookshelf removed",
        description: deletion.message,
        variant: "success",
      });
    } catch (requestError) {
      toast({
        title: "Could not remove bookshelf",
        description:
          requestError instanceof Error ? requestError.message : "Could not remove bookshelf.",
        variant: "error",
      });
    } finally {
      setDeletingBookshelfId(null);
    }
  };

  const onSendBookshelfTest = async (bookshelf: BookshelfSummary) => {
    const form = bookshelfForms[bookshelf.id] ?? toBookshelfFormState(bookshelf);
    const recipient = form.kindleEmail.trim();
    if (!recipient) return;

    setTestingBookshelfId(bookshelf.id);

    try {
      await api.sendTestEmail(recipient);
      toast({
        title: "Test email sent",
        description: `SMTP test email sent to ${recipient}.`,
        variant: "success",
      });
    } catch (requestError) {
      toast({
        title: "Could not send test email",
        description:
          requestError instanceof Error
            ? requestError.message
            : "Could not send the test email.",
        variant: "error",
      });
    } finally {
      setTestingBookshelfId(null);
    }
  };

  if (loading && !settings) {
    return <SettingsSkeleton />;
  }

  const smtpConfigured = Boolean(settings?.smtp.configured);
  const isBookshelfDirty = (bookshelf: BookshelfSummary) => {
    const form = bookshelfForms[bookshelf.id];
    if (!form) return false;
    return (
      form.name.trim() !== bookshelf.name ||
      (form.kindleEmail.trim() || null) !== (bookshelf.kindleEmail ?? null)
    );
  };

  return (
    <div className="page page-narrow stack-lg">
      <Button asChild className="backlink" variant="ghost">
        <Link to="/">
          <ArrowLeftIcon />
          Back to bookshelf
        </Link>
      </Button>

      {loadError ? <p className="inline-error">{loadError}</p> : null}

      <Card className="panel stack-md">
        <div className="stack-xs">
          <div className="section-heading">
            <h2>Bookshelves</h2>
            <Badge className="status-pill" variant="outline">
              {numberFormatter.format(bookshelves.length)} shelves
            </Badge>
          </div>
          <p className="lede">
            Each bookshelf keeps its own Kindle destination. Books can belong to more than one
            shelf without duplicating the EPUB file.
          </p>
          {!smtpConfigured ? (
            <p className="bookshelves-page-note">
              <Link to="/settings">Configure SMTP</Link> before sending test email from a shelf.
            </p>
          ) : null}
        </div>

        <div className="settings-bookshelf-list">
          {bookshelves.map((bookshelf) => {
            const form = bookshelfForms[bookshelf.id] ?? toBookshelfFormState(bookshelf);
            const dirty = isBookshelfDirty(bookshelf);
            const saving = savingBookshelfId === bookshelf.id;
            const deleting = deletingBookshelfId === bookshelf.id;
            const testing = testingBookshelfId === bookshelf.id;

            return (
              <form
                className="settings-bookshelf-row"
                key={bookshelf.id}
                onSubmit={(event) => {
                  event.preventDefault();
                  void onSaveBookshelf(bookshelf.id);
                }}
              >
                <div className="settings-bookshelf-fields">
                  <div className="stack-xs">
                    <Label className="field-label" htmlFor={`bookshelf-name-${bookshelf.id}`}>
                      Shelf name
                    </Label>
                    <Input
                      autoComplete="off"
                      id={`bookshelf-name-${bookshelf.id}`}
                      name={`bookshelf_name_${bookshelf.id}`}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setBookshelfForms((current) => ({
                          ...current,
                          [bookshelf.id]: {
                            ...form,
                            name: value,
                          },
                        }));
                      }}
                      placeholder="Me"
                      spellCheck={false}
                      type="text"
                      value={form.name}
                    />
                  </div>
                  <div className="stack-xs">
                    <Label className="field-label" htmlFor={`bookshelf-kindle-${bookshelf.id}`}>
                      Kindle email
                    </Label>
                    <Input
                      autoComplete="email"
                      id={`bookshelf-kindle-${bookshelf.id}`}
                      name={`bookshelf_kindle_${bookshelf.id}`}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setBookshelfForms((current) => ({
                          ...current,
                          [bookshelf.id]: {
                            ...form,
                            kindleEmail: value,
                          },
                        }));
                      }}
                      placeholder="name@kindle.com"
                      spellCheck={false}
                      type="email"
                      value={form.kindleEmail}
                    />
                  </div>
                </div>
                <div className="settings-bookshelf-meta">
                  <span>{numberFormatter.format(bookshelf.bookCount)} books</span>
                  {!smtpConfigured ? <span>SMTP not configured.</span> : null}
                </div>
                <div className="inline-actions">
                  <Button
                    disabled={!dirty || saving || deleting}
                    type="submit"
                  >
                    {saving ? "Saving\u2026" : "Save shelf"}
                  </Button>
                  <Button
                    disabled={
                      testing ||
                      deleting ||
                      !form.kindleEmail.trim() ||
                      !smtpConfigured
                    }
                    onClick={() => {
                      void onSendBookshelfTest(bookshelf);
                    }}
                    type="button"
                    variant="outline"
                  >
                    {testing ? "Sending\u2026" : "Send test email"}
                  </Button>
                  <Button
                    disabled={bookshelves.length <= 1 || saving || deleting}
                    onClick={() => {
                      void onDeleteBookshelf(bookshelf);
                    }}
                    type="button"
                    variant="ghost"
                  >
                    {deleting ? "Removing\u2026" : "Remove"}
                  </Button>
                </div>
              </form>
            );
          })}
        </div>

        <form className="settings-bookshelf-create" onSubmit={onCreateBookshelf}>
          <div className="settings-bookshelf-fields">
            <div className="stack-xs">
              <Label className="field-label" htmlFor="new-bookshelf-name">
                New shelf name
              </Label>
              <Input
                autoComplete="off"
                id="new-bookshelf-name"
                name="new_bookshelf_name"
                onChange={(event) =>
                  setNewBookshelf((current) => ({
                    ...current,
                    name: event.currentTarget.value,
                  }))
                }
                placeholder="Kid"
                spellCheck={false}
                type="text"
                value={newBookshelf.name}
              />
            </div>
            <div className="stack-xs">
              <Label className="field-label" htmlFor="new-bookshelf-kindle">
                Kindle email
              </Label>
              <Input
                autoComplete="email"
                id="new-bookshelf-kindle"
                name="new_bookshelf_kindle"
                onChange={(event) =>
                  setNewBookshelf((current) => ({
                    ...current,
                    kindleEmail: event.currentTarget.value,
                  }))
                }
                placeholder="name@kindle.com"
                spellCheck={false}
                type="email"
                value={newBookshelf.kindleEmail}
              />
            </div>
          </div>
          <div className="inline-actions">
            <Button disabled={creatingBookshelf || !newBookshelf.name.trim()} type="submit">
              {creatingBookshelf ? "Creating\u2026" : "Create bookshelf"}
            </Button>
          </div>
        </form>
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
      <Route element={<BookshelvesPage />} path="/bookshelves" />
      <Route element={<SettingsPage />} path="/settings" />
    </Route>
  </Routes>
);

export default function App() {
  const themeValue = useTheme();

  return (
    <ThemeContext.Provider value={themeValue}>
      <AppToastProvider>
        <AppRoutes />
      </AppToastProvider>
    </ThemeContext.Provider>
  );
}
