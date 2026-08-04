import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
} from "react";
import {
  startTransition,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  BOOKS_PAGE_SIZE,
  type BookSummary,
  type BookshelfSummary,
  type SettingsPayload,
} from "../../shared/types";
import {
  ALL_BOOKSHELVES_ID,
  BookshelfGrid,
  BookshelfList,
  BookshelfSidebar,
  BookshelfSkeleton,
  BOOKSHELF_SORT_OPTIONS,
  DEFAULT_BOOKSHELF_SORT,
  EMPTY_STATUS_COUNTS,
  getContextMenuPosition,
  getDefaultBookshelfSortDirection,
  getNextBookshelfSort,
  isContextMenuKey,
  type BookshelfContextMenuState,
  type BookshelfSort,
  type BookshelfSortKey,
  type ReadStatusFilter,
} from "../components/bookshelf";
import {
  DensityComfortableIcon,
  DensityCompactIcon,
  GridIcon,
  ListComfortableIcon,
  ListCompactIcon,
  ListIcon,
  UploadIcon,
} from "../components/icons";
import { BookActionMenu, type OverflowMenuItem } from "../components/menus";
import {
  DeleteBookModal,
  ImportBooksModal,
  ImportTargetModal,
  SendBookModal,
} from "../components/modals";
import {
  OnboardingChecklist,
  type OnboardingStep,
} from "../components/onboarding-checklist";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import { useDocumentTitle } from "../hooks/use-document-title";
import { useFileDropTarget } from "../hooks/use-file-drop-target";
import { useToast } from "../hooks/use-toast";
import { api } from "../lib/api";
import {
  getImportableFiles,
  getImportToastTitle,
  getImportToastVariant,
  IMPORT_BATCH_SIZE,
  INVALID_IMPORT_FILES_MESSAGE,
} from "../lib/file-import";
import { numberFormatter } from "../lib/format";
import { getReaderSearch, openReaderWindow } from "../lib/navigation";
import {
  getStoredBookshelfDensity,
  getStoredBookshelfSidebarMinimized,
  getStoredBookshelfView,
  getStoredOnboardingDismissed,
  setStoredBookshelfDensity,
  setStoredBookshelfSidebarMinimized,
  setStoredBookshelfView,
  setStoredOnboardingDismissed,
  type BookshelfDensity,
  type BookshelfView,
} from "../lib/storage";
export const BookshelfPage = () => {

  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [view, setView] = useState<BookshelfView>(() => getStoredBookshelfView() ?? "grid");
  const [density, setDensity] = useState<BookshelfDensity>(
    () => getStoredBookshelfDensity() ?? "comfortable",
  );
  const [isSidebarMinimized, setIsSidebarMinimized] = useState(
    getStoredBookshelfSidebarMinimized,
  );
  const [statusFilter, setStatusFilter] = useState<ReadStatusFilter>("all");
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [matchingBookCount, setMatchingBookCount] = useState(0);
  const [shelfBookCount, setShelfBookCount] = useState(0);
  const [statusCounts, setStatusCounts] =
    useState<Record<ReadStatusFilter, number>>(EMPTY_STATUS_COUNTS);
  const [pageOffset, setPageOffset] = useState(0);
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
  const [onboardingDismissed, setOnboardingDismissed] = useState(getStoredOnboardingDismissed);
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
  const debouncedQuery = useDebouncedValue(query, 250);
  const showingFilteredResults =
    debouncedQuery.trim().length > 0 || statusFilter !== "all";
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
        setMatchingBookCount(0);
        setShelfBookCount(0);
        setStatusCounts(EMPTY_STATUS_COUNTS);
        setPageOffset(0);
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

    setLoading(true);
    setError(null);

    try {
      const nextPage = await api.listBooks({
        query: debouncedQuery,
        bookshelfId:
          activeBookshelfId === ALL_BOOKSHELVES_ID ? null : activeBookshelfId,
        readStatus: statusFilter === "all" ? null : statusFilter,
        sort: bookshelfSort.key,
        direction: bookshelfSort.direction,
        offset: pageOffset,
        limit: BOOKS_PAGE_SIZE,
      });

      if (requestId !== latestBooksRequest.current) {
        return;
      }

      if (nextPage.books.length === 0 && nextPage.total > 0 && pageOffset >= nextPage.total) {
        setPageOffset(Math.floor((nextPage.total - 1) / BOOKS_PAGE_SIZE) * BOOKS_PAGE_SIZE);
        return;
      }

      setBooks(nextPage.books);
      setMatchingBookCount(nextPage.total);
      setShelfBookCount(nextPage.unfilteredTotal);
      setStatusCounts(nextPage.statusCounts);
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
  }, [
    activeBookshelfId,
    bookshelfSort.direction,
    bookshelfSort.key,
    debouncedQuery,
    hasLoadedBookshelves,
    pageOffset,
    statusFilter,
  ]);

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
    if (nextQuery !== query) {
      setQuery(nextQuery);
      setPageOffset(0);
    }
  }, [query, searchParams]);

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
    if (!books.some((book) => book.id === bookActionMenu.book.id)) {
      setBookActionMenu(null);
    }
  }, [bookActionMenu, books]);

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
    setStoredBookshelfView(nextView);
  }, []);

  const onChangeDensity = useCallback((nextDensity: BookshelfDensity) => {
    setDensity(nextDensity);
    setStoredBookshelfDensity(nextDensity);
  }, []);

  const onToggleSidebarMinimized = useCallback(() => {
    const nextMinimized = !isSidebarMinimized;
    setIsSidebarMinimized(nextMinimized);
    setStoredBookshelfSidebarMinimized(nextMinimized);
  }, [isSidebarMinimized]);

  const onChangeBookshelfSort = useCallback((key: BookshelfSortKey) => {
    setBookshelfSort((current) => getNextBookshelfSort(current, key));
    setPageOffset(0);
  }, []);

  const onSelectBookshelfSort = useCallback((key: BookshelfSortKey) => {
    setBookshelfSort({ key, direction: getDefaultBookshelfSortDirection(key) });
    setPageOffset(0);
  }, []);

  const onChangeStatusFilter = useCallback((status: ReadStatusFilter) => {
    setStatusFilter(status);
    setPageOffset(0);
  }, []);

  const onSelectBookshelf = useCallback(
    (bookshelfId: string) => {
      setPageOffset(0);
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
      setBookPendingDelete(null);
      await loadBooks();
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
  const showEmptyBookshelf = !showInitialBookshelfSkeleton && books.length === 0;
  const totalBookCount = bookshelves.reduce(
    (total, bookshelf) => total + bookshelf.bookCount,
    0,
  );
  const pageNumber = Math.floor(pageOffset / BOOKS_PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(matchingBookCount / BOOKS_PAGE_SIZE));
  const pageStart = matchingBookCount === 0 ? 0 : pageOffset + 1;
  const pageEnd = Math.min(pageOffset + books.length, matchingBookCount);
  const onboardingStep1Done = totalBookCount > 0;
  const onboardingStep2Done = Boolean(settings?.smtp.configured);
  const onboardingStep3Done = bookshelves.some((bookshelf) => bookshelf.kindleEmail?.trim());
  const onboardingComplete =
    onboardingStep1Done && onboardingStep2Done && onboardingStep3Done;
  const showOnboarding =
    hasLoadedBookshelves && hasLoadedSettings && !onboardingComplete && !onboardingDismissed;
  const onboardingSteps: OnboardingStep[] = [
    {
      id: "add-book",
      title: "Add your first book",
      description: "Drop EPUB files anywhere on this page, or browse to import them.",
      done: onboardingStep1Done,
      actionLabel: "Add EPUBs",
      onAction: () => setIsImportModalOpen(true),
      actionDisabled: uploading || !canImportBooks,
    },
    {
      id: "smtp",
      title: "Set up Send to Kindle",
      description:
        "Save your SMTP connection so Irulan can email books to your Kindle.",
      done: onboardingStep2Done,
      actionLabel: "Open settings",
      onAction: () => navigate("/settings"),
    },
    {
      id: "kindle-address",
      title: "Add a Kindle address & send a test",
      description:
        "Give a bookshelf a Kindle email, then send a test from the bookshelves page.",
      done: onboardingStep3Done,
      actionLabel: "Open bookshelves",
      onAction: () => navigate("/bookshelves"),
    },
  ];
  const dismissOnboarding = () => {
    setStoredOnboardingDismissed(true);
    setOnboardingDismissed(true);
  };
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
        showEmptyBookshelf && !showOnboarding && "bookshelf-dropzone-shell-empty",
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
          isSidebarMinimized && "bookshelf-layout-minimized",
          bookshelfDropTarget.isActive && "bookshelf-dropzone-content-muted",
        )}
      >
        <BookshelfSidebar
          activeBookshelfId={activeBookshelfId}
          bookshelves={bookshelves}
          totalBookCount={totalBookCount}
          statusFilter={statusFilter}
          statusCounts={statusCounts}
          minimized={isSidebarMinimized}
          onSelectBookshelf={onSelectBookshelf}
          onChangeStatusFilter={onChangeStatusFilter}
          onToggleMinimized={onToggleSidebarMinimized}
        />

        <div aria-busy={loading} className="bookshelf-main stack-lg">
          <header className="bookshelf-main-header">
            <div className="bookshelf-main-heading">
              <h1 className="bookshelf-main-title">
                {activeBookshelfId === ALL_BOOKSHELVES_ID
                  ? "All books"
                  : activeBookshelf?.name ?? "Bookshelf"}
              </h1>
              <p className="bookshelf-main-subtitle">
                {numberFormatter.format(shelfBookCount)}
                {shelfBookCount === 1 ? " book" : " books"}
                {showingFilteredResults
                  ? ` \u00b7 ${numberFormatter.format(matchingBookCount)} shown`
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

          {showOnboarding ? (
            <OnboardingChecklist steps={onboardingSteps} onDismiss={dismissOnboarding} />
          ) : null}

          {!showOnboarding &&
          hasLoadedSettings &&
          activeBookshelf &&
          !activeBookshelf.kindleEmail ? (
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
                setPageOffset(0);
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
        ) : books.length === 0 ? (
          <section className="empty-state empty-dropzone stack-sm">
            <div className="empty-dropzone-icon" aria-hidden="true">
              <UploadIcon />
            </div>
            <h2>{showingFilteredResults ? "No matching books" : "No books yet"}</h2>
            {!showingFilteredResults ? (
              <p className="empty-state-tagline">
                Your private EPUB library {"\u2014"} read in the app, or send any book to your
                Kindle.
              </p>
            ) : null}
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
                    setPageOffset(0);
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
            books={books}
            bookshelfId={activeBookshelfId}
            density={density}
            onBookContextKeyDown={onBookContextKeyDown}
            onBookContextMenu={onBookContextMenu}
            onChangeSort={onChangeBookshelfSort}
            sort={bookshelfSort}
          />
        ) : (
          <BookshelfGrid
            books={books}
            bookshelfId={activeBookshelfId}
            density={density}
            sortKey={bookshelfSort.key}
            onBookContextKeyDown={onBookContextKeyDown}
            onBookContextMenu={onBookContextMenu}
            onOpenActionMenu={onOpenBookActionMenu}
          />
        )}
        {!showInitialBookshelfSkeleton && matchingBookCount > 0 ? (
          <nav aria-label="Bookshelf pages" className="bookshelf-pagination">
            <Button
              disabled={loading || pageOffset === 0}
              onClick={() => setPageOffset((current) => Math.max(0, current - BOOKS_PAGE_SIZE))}
              size="sm"
              type="button"
              variant="outline"
            >
              Previous
            </Button>
            <p aria-live="polite" className="bookshelf-pagination-status">
              Showing {numberFormatter.format(pageStart)}–{numberFormatter.format(pageEnd)} of{" "}
              {numberFormatter.format(matchingBookCount)} · Page {numberFormatter.format(pageNumber)}{" "}
              of {numberFormatter.format(pageCount)}
            </p>
            <Button
              disabled={loading || pageOffset + books.length >= matchingBookCount}
              onClick={() => setPageOffset((current) => current + BOOKS_PAGE_SIZE)}
              size="sm"
              type="button"
              variant="outline"
            >
              Next
            </Button>
          </nav>
        ) : null}
        </div>
      </div>
    </div>
  );
};

