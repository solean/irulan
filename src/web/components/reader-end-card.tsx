import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReadStatus } from "../../shared/types";
import { useToast } from "../hooks/use-toast";
import { api } from "../lib/api";
import { DrawnCheck } from "./book";

type ReaderEndCardProps = {
  bookId: string;
  title: string;
};

/**
 * Shown on the last page of the last section. Mount it per arrival at the end;
 * it renders nothing until the book's read status is known, so it never flips
 * from "Mark as finished" to "Finished" in front of the reader.
 */
export const ReaderEndCard = ({ bookId, title }: ReaderEndCardProps) => {
  const toast = useToast();
  const [status, setStatus] = useState<ReadStatus | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getBook(bookId).then(
      (book) => {
        if (!cancelled) setStatus(book.readStatus);
      },
      // Without a known status there is nothing honest to offer; stay hidden.
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  if (!status || dismissed) return null;

  const finished = status === "finished";

  const markFinished = async () => {
    setSaving(true);
    try {
      const saved = await api.saveBookMetadata(bookId, { readStatus: "finished" });
      setStatus(saved.readStatus);
      setJustFinished(saved.readStatus === "finished");
    } catch (requestError) {
      toast({
        title: "Could not mark as finished",
        description:
          requestError instanceof Error ? requestError.message : "Could not save the read status.",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="End of book" className="reader-end-card">
      <span className={cn("reader-end-mark", finished && "reader-end-mark-finished")}>
        {finished ? <DrawnCheck draw={justFinished} /> : null}
      </span>
      <div aria-live="polite" className="reader-end-copy">
        <strong>
          {finished ? (justFinished ? "Marked as finished" : "Finished") : "You\u2019ve reached the end"}
        </strong>
        <span title={title}>{title}</span>
      </div>
      {finished ? null : (
        <Button disabled={saving} onClick={() => void markFinished()} size="sm" type="button">
          {saving ? "Saving\u2026" : "Mark as finished"}
        </Button>
      )}
      <Button
        aria-label="Dismiss"
        className="reader-end-dismiss"
        onClick={() => setDismissed(true)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <XIcon />
      </Button>
    </section>
  );
};
