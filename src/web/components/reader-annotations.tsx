import {
  type CSSProperties,
  type FormEvent,
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MAX_READER_ANNOTATION_NOTE_LENGTH,
  MAX_READER_ANNOTATION_QUOTE_LENGTH,
  READER_ANNOTATION_COLORS,
  type ReaderAnnotation,
  type ReaderAnnotationColor,
  type ReaderTextRange,
} from "../../shared/types";
import { api } from "../lib/api";
import {
  resolveReaderTextRange,
  serializeReaderTextRange,
} from "../lib/reader-location";

type ReaderAnnotationsProps = {
  bookId: string;
  contentRevision: Document | null;
  getSectionLabel: (href: string) => string;
  onNavigate: (range: ReaderTextRange) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  readerRootRef: RefObject<HTMLElement | null>;
  sectionHref: string | null;
  viewportRef: RefObject<HTMLElement | null>;
};

type SelectedText = {
  below: boolean;
  copyText: string;
  left: number;
  range: ReaderTextRange;
  top: number;
};

const highlightName = (color: ReaderAnnotationColor) => `reader-annotation-${color}`;

const replaceAnnotation = (annotations: ReaderAnnotation[], updated: ReaderAnnotation) =>
  annotations.map((annotation) => (annotation.id === updated.id ? updated : annotation));

export const ReaderAnnotations = ({
  bookId,
  contentRevision,
  getSectionLabel,
  onNavigate,
  onOpenChange,
  open,
  readerRootRef,
  sectionHref,
  viewportRef,
}: ReaderAnnotationsProps) => {
  const latestRequest = useRef(0);
  const selectionFrame = useRef<number | null>(null);
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([]);
  const [selectedText, setSelectedText] = useState<SelectedText | null>(null);
  const [selectedColor, setSelectedColor] = useState<ReaderAnnotationColor>("yellow");
  const [noteTarget, setNoteTarget] = useState<ReaderTextRange | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    setAnnotations([]);
    setSelectedText(null);
    setLoading(true);
    setError(null);
    void api
      .listReaderAnnotations(bookId)
      .then((nextAnnotations) => {
        if (latestRequest.current !== requestId) return;
        setAnnotations(nextAnnotations);
      })
      .catch((requestError) => {
        if (latestRequest.current !== requestId) return;
        setError(requestError instanceof Error ? requestError.message : "Could not load highlights.");
      })
      .finally(() => {
        if (latestRequest.current === requestId) setLoading(false);
      });
  }, [bookId]);

  useLayoutEffect(() => {
    if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return;

    for (const color of READER_ANNOTATION_COLORS) {
      CSS.highlights.delete(highlightName(color));
    }

    const root = readerRootRef.current;
    if (!root || !sectionHref) return;

    for (const color of READER_ANNOTATION_COLORS) {
      const ranges = annotations
        .filter(
          (annotation) =>
            annotation.bookId === bookId &&
            annotation.color === color &&
            annotation.range.sectionHref === sectionHref,
        )
        .map((annotation) => resolveReaderTextRange(root, annotation.range))
        .filter((range): range is Range => range !== null);
      if (ranges.length > 0) {
        CSS.highlights.set(highlightName(color), new Highlight(...ranges));
      }
    }

    return () => {
      for (const color of READER_ANNOTATION_COLORS) {
        CSS.highlights.delete(highlightName(color));
      }
    };
  }, [annotations, bookId, contentRevision, readerRootRef, sectionHref]);

  const clearSelection = useCallback(() => {
    setSelectedText(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const updateSelection = useEffectEvent(() => {
    const root = readerRootRef.current;
    const viewport = viewportRef.current;
    if (!root || !viewport || !sectionHref || !contentRevision) {
      setSelectedText(null);
      return;
    }

    const selection = window.getSelection();
    if (selection?.rangeCount !== 1 || selection.isCollapsed) {
      setSelectedText(null);
      return;
    }

    const domRange = selection.getRangeAt(0);
    if (!root.contains(domRange.startContainer) || !root.contains(domRange.endContainer)) {
      setSelectedText(null);
      return;
    }

    const range = serializeReaderTextRange(sectionHref, root, domRange);
    if (!range) {
      setSelectedText(null);
      return;
    }

    const viewportBounds = viewport.getBoundingClientRect();
    const visibleBounds = Array.from(domRange.getClientRects()).filter(
      (bounds) =>
        bounds.right > viewportBounds.left &&
        bounds.left < viewportBounds.right &&
        bounds.bottom > viewportBounds.top &&
        bounds.top < viewportBounds.bottom,
    );
    const bounds = visibleBounds.at(-1) ?? domRange.getBoundingClientRect();
    const left = Math.max(20, Math.min(window.innerWidth - 20, bounds.left + bounds.width / 2));
    const below = bounds.top < 72;
    setSelectedText({
      below,
      copyText: selection.toString(),
      left,
      range,
      top: below ? bounds.bottom + 10 : bounds.top - 10,
    });
  });

  useEffect(() => {

    const scheduleSelectionUpdate = () => {
      if (selectionFrame.current !== null) window.cancelAnimationFrame(selectionFrame.current);
      selectionFrame.current = window.requestAnimationFrame(() => {
        selectionFrame.current = null;
        updateSelection();
      });
    };

    document.addEventListener("selectionchange", scheduleSelectionUpdate);
    window.addEventListener("resize", scheduleSelectionUpdate);
    return () => {
      document.removeEventListener("selectionchange", scheduleSelectionUpdate);
      window.removeEventListener("resize", scheduleSelectionUpdate);
      if (selectionFrame.current !== null) window.cancelAnimationFrame(selectionFrame.current);
      selectionFrame.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open && !selectedText) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape" || noteTarget) return;
      event.preventDefault();
      if (selectedText) {
        clearSelection();
      } else {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearSelection, noteTarget, onOpenChange, open, selectedText]);

  const createAnnotation = useCallback(
    async (range: ReaderTextRange, note: string | null) => {
      if (range.exact.length > MAX_READER_ANNOTATION_QUOTE_LENGTH) {
        setError(
          `Selections must be ${MAX_READER_ANNOTATION_QUOTE_LENGTH.toLocaleString()} characters or fewer.`,
        );
        return false;
      }

      setSaving(true);
      setError(null);
      setStatus(null);
      try {
        const annotation = await api.createReaderAnnotation(bookId, {
          range,
          color: selectedColor,
          note,
        });
        setAnnotations((current) =>
          current.some((item) => item.id === annotation.id)
            ? replaceAnnotation(current, annotation)
            : [annotation, ...current],
        );
        setStatus(note ? "Note saved." : "Highlight saved.");
        clearSelection();
        return true;
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Could not save the highlight.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [bookId, clearSelection, selectedColor],
  );

  const copySelection = useCallback(async () => {
    if (!selectedText) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(selectedText.copyText);
      setStatus("Selected text copied.");
    } catch {
      setError("The selected text could not be copied to the clipboard.");
    }
  }, [selectedText]);

  const saveNewNote = useCallback(async () => {
    if (!noteTarget || !noteDraft.trim()) return;
    const saved = await createAnnotation(noteTarget, noteDraft.trim());
    if (saved) {
      setNoteTarget(null);
      setNoteDraft("");
    }
  }, [createAnnotation, noteDraft, noteTarget]);

  const updateColor = useCallback(
    async (annotation: ReaderAnnotation, color: ReaderAnnotationColor) => {
      setSaving(true);
      setError(null);
      try {
        const updated = await api.updateReaderAnnotation(bookId, annotation.id, { color });
        setAnnotations((current) => replaceAnnotation(current, updated));
        setStatus("Highlight colour updated.");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Could not update the colour.");
      } finally {
        setSaving(false);
      }
    },
    [bookId],
  );

  const beginNoteEdit = useCallback((annotation: ReaderAnnotation) => {
    setEditingId(annotation.id);
    setEditingNote(annotation.note ?? "");
    setError(null);
    setStatus(null);
  }, []);

  const saveEditedNote = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!editingId) return;
      setSaving(true);
      setError(null);
      try {
        const updated = await api.updateReaderAnnotation(bookId, editingId, {
          note: editingNote.trim() || null,
        });
        setAnnotations((current) => replaceAnnotation(current, updated));
        setEditingId(null);
        setStatus("Note updated.");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Could not update the note.");
      } finally {
        setSaving(false);
      }
    },
    [bookId, editingId, editingNote],
  );

  const deleteAnnotation = useCallback(
    async (annotationId: string) => {
      setSaving(true);
      setError(null);
      try {
        await api.deleteReaderAnnotation(bookId, annotationId);
        setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId));
        setStatus("Highlight deleted.");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Could not delete the highlight.");
      } finally {
        setSaving(false);
      }
    },
    [bookId],
  );

  const selectionToolbarStyle = selectedText
    ? ({
        left: selectedText.left,
        top: selectedText.top,
        transform: selectedText.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
      } satisfies CSSProperties)
    : undefined;

  return (
    <>
      {!open && (error || status) ? (
        <div aria-live="polite" className="sr-only">
          {error ?? status}
        </div>
      ) : null}
      {selectedText ? (
        <div
          aria-label="Selected text actions"
          className="reader-selection-toolbar"
          onPointerDown={(event) => event.preventDefault()}
          role="toolbar"
          style={selectionToolbarStyle}
        >
          <div aria-label="Highlight colour" className="reader-highlight-colors" role="group">
            {READER_ANNOTATION_COLORS.map((color) => (
              <button
                aria-label={`${color} highlight`}
                aria-pressed={selectedColor === color}
                className="reader-highlight-color"
                data-color={color}
                key={color}
                onClick={() => setSelectedColor(color)}
                type="button"
              />
            ))}
          </div>
          <Button
            disabled={saving || selectedText.range.exact.length > MAX_READER_ANNOTATION_QUOTE_LENGTH}
            onClick={() => void createAnnotation(selectedText.range, null)}
            size="sm"
            type="button"
          >
            Highlight
          </Button>
          <Button
            disabled={saving || selectedText.range.exact.length > MAX_READER_ANNOTATION_QUOTE_LENGTH}
            onClick={() => {
              setNoteTarget(selectedText.range);
              setNoteDraft("");
              clearSelection();
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Note
          </Button>
          <Button onClick={() => void copySelection()} size="sm" type="button" variant="ghost">
            Copy
          </Button>
        </div>
      ) : null}

      {open ? (
        <aside aria-label="Highlights and notes" className="reader-tool-panel" role="dialog">
          <div className="reader-tool-panel-header">
            <div>
              <p className="eyebrow">Reader tools</p>
              <h2>Highlights &amp; notes</h2>
            </div>
            <Button aria-label="Close highlights" onClick={() => onOpenChange(false)} size="sm" variant="ghost">
              Close
            </Button>
          </div>

          <p className="reader-tool-help">Select text in the book to highlight it, add a note, or copy it.</p>
          <div aria-live="polite" className="reader-tool-status">
            {loading ? "Loading highlights…" : status}
          </div>
          {error ? <p className="inline-error">{error}</p> : null}

          {!loading && annotations.length === 0 ? (
            <div className="reader-tool-empty">
              <strong>No highlights yet</strong>
              <span>Select a passage in the current page to begin.</span>
            </div>
          ) : null}

          <ol className="reader-tool-list">
            {annotations.map((annotation) => (
              <li className="reader-tool-card" key={annotation.id}>
                <button
                  className="reader-tool-card-target"
                  onClick={() => {
                    onNavigate(annotation.range);
                    onOpenChange(false);
                  }}
                  type="button"
                >
                  <span className="reader-tool-card-title">
                    {annotation.note ? "Note" : "Highlight"}
                  </span>
                  <span className="reader-tool-card-section">
                    {getSectionLabel(annotation.range.sectionHref)}
                  </span>
                  <span className="reader-annotation-quote">“{annotation.range.exact}”</span>
                  {annotation.note ? <span className="reader-annotation-note">{annotation.note}</span> : null}
                </button>

                {editingId === annotation.id ? (
                  <form className="reader-annotation-edit" onSubmit={saveEditedNote}>
                    <label htmlFor={`reader-annotation-note-${annotation.id}`}>Note</label>
                    <textarea
                      id={`reader-annotation-note-${annotation.id}`}
                      maxLength={MAX_READER_ANNOTATION_NOTE_LENGTH}
                      onChange={(event) => setEditingNote(event.target.value)}
                      rows={4}
                      value={editingNote}
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
                  <div className="reader-tool-card-actions">
                    <label className="reader-annotation-color-label">
                      <span className="sr-only">Highlight colour</span>
                      <select
                        disabled={saving}
                        onChange={(event) =>
                          void updateColor(annotation, event.target.value as ReaderAnnotationColor)
                        }
                        value={annotation.color}
                      >
                        {READER_ANNOTATION_COLORS.map((color) => (
                          <option key={color} value={color}>
                            {color[0].toUpperCase() + color.slice(1)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button onClick={() => beginNoteEdit(annotation)} size="sm" type="button" variant="ghost">
                      {annotation.note ? "Edit note" : "Add note"}
                    </Button>
                    <Button
                      disabled={saving}
                      onClick={() => void deleteAnnotation(annotation.id)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </aside>
      ) : null}

      <Dialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setNoteTarget(null);
            setNoteDraft("");
          }
        }}
        open={noteTarget !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a note</DialogTitle>
            <DialogDescription>
              The selected quote and this note will stay attached when the book is repaginated.
            </DialogDescription>
          </DialogHeader>
          {noteTarget ? <blockquote className="reader-note-quote">“{noteTarget.exact}”</blockquote> : null}
          <label className="reader-note-label" htmlFor="reader-new-note">
            Note
          </label>
          <textarea
            autoFocus
            id="reader-new-note"
            maxLength={MAX_READER_ANNOTATION_NOTE_LENGTH}
            onChange={(event) => setNoteDraft(event.target.value)}
            placeholder="Write a note…"
            rows={6}
            value={noteDraft}
          />
          {error ? <p className="inline-error">{error}</p> : null}
          <DialogFooter>
            <Button
              onClick={() => {
                setNoteTarget(null);
                setNoteDraft("");
              }}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button disabled={saving || !noteDraft.trim()} onClick={() => void saveNewNote()} type="button">
              {saving ? "Saving…" : "Save note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
