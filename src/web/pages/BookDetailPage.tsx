import type { FormEvent } from "react";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import type {
  BookDetail,
  BookshelfSummary,
  DeliveryRecord,
  SettingsPayload,
  UpdateBookMetadataPayload,
} from "../../shared/types";
import {
  BookCover,
  BookMetadataEditor,
  RatingStars,
  ReadStatusBadge,
} from "../components/book";
import {
  ArrowLeftIcon,
  CopyIcon,
  EditIcon,
  FolderIcon,
  MailIcon,
  PlayIcon,
} from "../components/icons";
import { OverflowMenu, type OverflowMenuItem } from "../components/menus";
import { DeleteBookModal } from "../components/modals";
import { BookDetailSkeleton } from "../components/skeletons";
import { useDocumentTitle } from "../hooks/use-document-title";
import { useToast } from "../hooks/use-toast";
import { api } from "../lib/api";
import { formatBytes, formatDate, formatRelative, numberFormatter } from "../lib/format";
import {
  getBookshelfHref,
  getReaderSearch,
  openReaderWindow,
} from "../lib/navigation";
import { getStatusBadgeVariant } from "../lib/status";

export const BookDetailPage = () => {
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

  const onShowBookFile = async () => {
    if (!book) return;
    const bridge = typeof window !== "undefined" ? window.irulan : undefined;
    if (!bridge?.showBookFile) return;

    try {
      await bridge.showBookFile(book.id);
    } catch (requestError) {
      toast({
        title: "Could not open Finder",
        description:
          requestError instanceof Error
            ? requestError.message
            : "The EPUB file could not be revealed.",
        variant: "error",
      });
    }
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
  const canShowBookFile = Boolean(
    typeof window !== "undefined" && window.irulan?.showBookFile,
  );

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
                className="about-grid-file-action"
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
              {canShowBookFile ? (
                <Button
                  aria-label={`Open ${book.sourceFilename} in Finder`}
                  className="about-grid-file-action"
                  onClick={() => {
                    void onShowBookFile();
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <FolderIcon />
                  <span>Open in Finder</span>
                </Button>
              ) : null}
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
