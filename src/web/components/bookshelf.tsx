import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
} from "react";
import {
  Link,
  useNavigate,
} from "react-router-dom";

import { Button } from "@/components/ui/button";

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

import {
  type BookSortKey,
  type BookSummary,
  type BookshelfSummary,
  type ReadStatus,
  type SortDirection,
} from "../../shared/types";
import {
  type BookshelfDensity,
  type BookshelfView,
} from "../lib/storage";
import {
  formatBytes,
  formatDate,
  formatDisplayTitle,
  formatRelative,
  numberFormatter,
} from "../lib/format";
import { getBookHref } from "../lib/navigation";
import { BookCover, BookMetadataStrip } from "./book";
import {
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  MoreIcon,
  SortIcon,
} from "./icons";
export type ReadStatusFilter = "all" | ReadStatus;
export type BookshelfSortKey = BookSortKey;
export type BookshelfSort = {
  key: BookshelfSortKey;
  direction: SortDirection;
};
export type BookshelfContextMenuState = {
  book: BookSummary;
  x: number;
  y: number;
};

export const ALL_BOOKSHELVES_ID = "all";
export const DEFAULT_BOOKSHELF_SORT: BookshelfSort = {
  key: "importedAt",
  direction: "desc",
};
export const BOOKSHELF_SORT_OPTIONS: ReadonlyArray<{ value: BookshelfSortKey; label: string }> = [
  { value: "importedAt", label: "Recently added" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "readStatus", label: "Read status" },
  { value: "rating", label: "Rating" },
  { value: "sourceFilename", label: "Filename" },
  { value: "fileSizeBytes", label: "File size" },
];
const READ_STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: ReadStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "reading", label: "Reading" },
  { value: "unread", label: "Unread" },
  { value: "finished", label: "Finished" },
];
export const EMPTY_STATUS_COUNTS: Record<ReadStatusFilter, number> = {
  all: 0,
  unread: 0,
  reading: 0,
  finished: 0,
};




export const getDefaultBookshelfSortDirection = (key: BookshelfSortKey): SortDirection =>
  key === "importedAt" || key === "fileSizeBytes" || key === "rating" ? "desc" : "asc";

export const getNextBookshelfSort = (current: BookshelfSort, key: BookshelfSortKey): BookshelfSort => {
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



const getAriaSort = (
  sort: BookshelfSort,
  key: BookshelfSortKey,
): "ascending" | "descending" | "none" =>
  sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none";

export const getContextMenuPosition = (x: number, y: number) => {
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

export const isContextMenuKey = (event: ReactKeyboardEvent<HTMLElement>) =>
  event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
export const SkeletonLine = ({ className = "" }: { className?: string }) => (
  <Skeleton aria-hidden="true" className={`skeleton-line${className ? ` ${className}` : ""}`} />
);

export const BookshelfSkeleton = ({ view }: { view: BookshelfView }) => {
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

export const BookshelfGrid = ({
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

export const BookshelfList = ({
  books,
  bookshelfId,
  density,
  sort,
  onBookContextKeyDown,
  onBookContextMenu,
  onChangeSort,
}: BookshelfListProps) => {
  const navigate = useNavigate();

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
              className="books-table-row books-table-row-clickable border-0"
              key={book.id}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a, button")) return;
                navigate(getBookHref(book.id, bookshelfId));
              }}
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
  libraryBookCount: number;
  statusFilter: ReadStatusFilter;
  statusCounts: Record<ReadStatusFilter, number>;
  minimized: boolean;
  onSelectBookshelf: (bookshelfId: string) => void;
  onChangeStatusFilter: (status: ReadStatusFilter) => void;
  onToggleMinimized: () => void;
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

export const BookshelfSidebar = ({
  activeBookshelfId,
  bookshelves,
  libraryBookCount,
  statusFilter,
  statusCounts,
  minimized,
  onSelectBookshelf,
  onChangeStatusFilter,
  onToggleMinimized,
}: BookshelfSidebarProps) => (
  <aside
    aria-label="Library navigation"
    className={cn("bookshelf-sidebar", minimized && "bookshelf-sidebar-minimized")}
  >
    <div className="bookshelf-sidebar-header">
      <Button
        aria-expanded={!minimized}
        aria-label={minimized ? "Expand sidebar" : "Minimize sidebar"}
        className="sidebar-toggle"
        onClick={onToggleMinimized}
        size="icon-sm"
        title={minimized ? "Expand sidebar" : "Minimize sidebar"}
        type="button"
        variant="ghost"
      >
        <span aria-hidden="true" className="sidebar-toggle-icon">
          <PanelLeftClose className="sidebar-toggle-icon-minimize" />
          <PanelLeftOpen className="sidebar-toggle-icon-expand" />
        </span>
      </Button>
    </div>

    <div
      aria-hidden={minimized}
      className="bookshelf-sidebar-content-shell"
      inert={minimized ? true : undefined}
    >
      <div className="bookshelf-sidebar-content">
        <section className="sidebar-section">
          <h2 className="sidebar-section-title">Library</h2>
          <div className="sidebar-list" role="group">
            <SidebarItem
              active={activeBookshelfId === ALL_BOOKSHELVES_ID}
              count={libraryBookCount}
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
      </div>
    </div>
  </aside>
);

