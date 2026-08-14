import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReaderBookmark, ReaderTextLocation } from "../../shared/types";
import { MAX_READER_BOOKMARK_LABEL_LENGTH } from "../../shared/types";
import { useDismissOnOutsidePress } from "../hooks/use-dismiss-on-outside-press";
import { api } from "../lib/api";

type ReaderBookmarksProps = {
  bookId: string;
  getCurrentLocation: () => ReaderTextLocation | null;
  getSectionLabel: (href: string) => string;
  onNavigate: (location: ReaderTextLocation) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export const ReaderBookmarks = ({
  bookId,
  getCurrentLocation,
  getSectionLabel,
  onNavigate,
  onOpenChange,
  open,
}: ReaderBookmarksProps) => {
  const panelRef = useRef<HTMLElement | null>(null);
  const latestRequest = useRef(0);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
  const [loadedBookId, setLoadedBookId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setBookmarks([]);
    setLoadedBookId(null);
    setEditingId(null);
    setError(null);
    setStatus(null);
  }, [bookId]);

  useEffect(() => {
    if (!open || loadedBookId === bookId) return;
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    setLoading(true);
    setError(null);
    void api
      .listReaderBookmarks(bookId)
      .then((nextBookmarks) => {
        if (latestRequest.current !== requestId) return;
        setBookmarks(nextBookmarks);
        setLoadedBookId(bookId);
      })
      .catch((requestError) => {
        if (latestRequest.current !== requestId) return;
        setError(requestError instanceof Error ? requestError.message : "Could not load bookmarks.");
      })
      .finally(() => {
        if (latestRequest.current === requestId) setLoading(false);
      });
  }, [bookId, loadedBookId, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (editingId) {
        setEditingId(null);
      } else {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingId, onOpenChange, open]);

  useEffect(() => {
    if (!editingId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [editingId]);

  const addBookmark = useCallback(async () => {
    const location = getCurrentLocation();
    if (!location) {
      setError("No text is on screen to bookmark. Try a page with text once it has loaded.");
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const bookmark = await api.createReaderBookmark(bookId, { location });
      setBookmarks((current) => [bookmark, ...current]);
      setLoadedBookId(bookId);
      setStatus("Bookmark added at the current position.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not add the bookmark.");
    } finally {
      setSaving(false);
    }
  }, [bookId, getCurrentLocation]);

  const beginRename = useCallback((bookmark: ReaderBookmark) => {
    setEditingId(bookmark.id);
    setLabelDraft(bookmark.label ?? "");
    setError(null);
    setStatus(null);
  }, []);

  const saveRename = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!editingId) return;
      setSaving(true);
      setError(null);
      try {
        const updated = await api.updateReaderBookmark(bookId, editingId, {
          label: labelDraft.trim() || null,
        });
        setBookmarks((current) =>
          current.map((bookmark) => (bookmark.id === updated.id ? updated : bookmark)),
        );
        setEditingId(null);
        setStatus("Bookmark name updated.");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Could not rename the bookmark.");
      } finally {
        setSaving(false);
      }
    },
    [bookId, editingId, labelDraft],
  );

  const deleteBookmark = useCallback(
    async (bookmarkId: string) => {
      setSaving(true);
      setError(null);
      setStatus(null);
      try {
        await api.deleteReaderBookmark(bookId, bookmarkId);
        setBookmarks((current) => current.filter((bookmark) => bookmark.id !== bookmarkId));
        setStatus("Bookmark deleted.");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Could not delete the bookmark.");
      } finally {
        setSaving(false);
      }
    },
    [bookId],
  );

  useDismissOnOutsidePress(panelRef, open, () => onOpenChange(false));

  if (!open) return null;

  return (
    <aside aria-label="Bookmarks" className="reader-tool-panel" ref={panelRef} role="dialog">
      <div className="reader-tool-panel-header">
        <div>
          <p className="eyebrow">Reader tools</p>
          <h2>Bookmarks</h2>
        </div>
        <Button aria-label="Close bookmarks" onClick={() => onOpenChange(false)} size="sm" variant="ghost">
          Close
        </Button>
      </div>

      <Button disabled={saving} onClick={() => void addBookmark()} type="button">
        {saving ? "Saving…" : "Add bookmark here"}
      </Button>

      <div aria-live="polite" className="reader-tool-status">
        {loading ? "Loading bookmarks…" : status}
      </div>
      {error ? <p className="inline-error">{error}</p> : null}

      {!loading && bookmarks.length === 0 ? (
        <div className="reader-tool-empty">
          <strong>No bookmarks yet</strong>
          <span>Add one at the text currently on screen.</span>
        </div>
      ) : null}

      <ol className="reader-tool-list">
        {bookmarks.map((bookmark) => (
          <li className="reader-tool-card" key={bookmark.id}>
            {editingId === bookmark.id ? (
              <form className="reader-bookmark-rename" onSubmit={saveRename}>
                <label className="sr-only" htmlFor={`reader-bookmark-label-${bookmark.id}`}>
                  Bookmark name
                </label>
                <Input
                  id={`reader-bookmark-label-${bookmark.id}`}
                  maxLength={MAX_READER_BOOKMARK_LABEL_LENGTH}
                  onChange={(event) => setLabelDraft(event.target.value)}
                  placeholder="Optional name"
                  ref={renameInputRef}
                  value={labelDraft}
                />
                <div className="reader-tool-card-actions">
                  <Button disabled={saving} size="sm" type="submit">
                    Save
                  </Button>
                  <Button onClick={() => setEditingId(null)} size="sm" type="button" variant="ghost">
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <button
                  className="reader-tool-card-target"
                  onClick={() => {
                    onNavigate(bookmark.location);
                    onOpenChange(false);
                  }}
                  type="button"
                >
                  <span className="reader-tool-card-title">{bookmark.label ?? "Bookmark"}</span>
                  <span className="reader-tool-card-section">
                    {getSectionLabel(bookmark.location.sectionHref)}
                  </span>
                  <span className="reader-tool-card-quote">
                    {bookmark.location.suffix.trim() || bookmark.location.prefix.trim()}
                  </span>
                </button>
                <div className="reader-tool-card-actions">
                  <Button onClick={() => beginRename(bookmark)} size="sm" type="button" variant="ghost">
                    Rename
                  </Button>
                  <Button
                    disabled={saving}
                    onClick={() => void deleteBookmark(bookmark.id)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Delete
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
};
