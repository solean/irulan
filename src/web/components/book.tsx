import type {
  CSSProperties,
} from "react";
import { useState } from "react";
import { StarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  READ_STATUSES,
  type BookDetail,
  type BookSummary,
  type ReadStatus,
  type UpdateBookMetadataPayload,
} from "../../shared/types";

export const READ_STATUS_LABELS: Record<ReadStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  finished: "Finished",
};
export const READ_STATUS_OPTIONS: ReadonlyArray<{ value: ReadStatus; label: string }> =
  READ_STATUSES.map((value) => ({ value, label: READ_STATUS_LABELS[value] }));
const formatRatingValue = (rating: number) =>
  Number.isInteger(rating) ? String(rating) : rating.toFixed(1);

const getRatingLabel = (rating: number | null) =>
  rating ? `${formatRatingValue(rating)} out of 5 stars` : "No rating";

const getStarFill = (rating: number | null, index: number) => {
  if (!rating) return 0;
  return Math.max(0, Math.min(1, rating - index));
};

export const ReadStatusBadge = ({ status }: { status: ReadStatus }) => (
  <span className={cn("read-status-badge", `read-status-${status}`)}>
    {READ_STATUS_LABELS[status]}
  </span>
)

export const RatingStars = ({
  compact = false,
  rating,
  filledOnly = false,
  previewRating,
}: {
  compact?: boolean;
  rating: number | null;
  filledOnly?: boolean;
  previewRating?: number;
}) => {
  const label = getRatingLabel(rating);

  // filledOnly trims the empty trailing stars instead of always padding to 5.
  // It must still round *up* so a half star keeps its own frame and renders at
  // 50% fill — rounding to whole stars showed 3.5 as 4.
  if (filledOnly && !rating) return null;
  const starCount = filledOnly && rating ? Math.ceil(rating) : 5;

  return (
    <span
      aria-label={label}
      className={cn(
        "rating-stars",
        previewRating !== undefined && "rating-stars-preview",
        compact && "rating-stars-compact",
      )}
      role="img"
      title={label}
    >
      {Array.from({ length: starCount }, (_, index) => {
        const fill = getStarFill(rating, index);
        const previewFill = getStarFill(previewRating ?? null, index);
        return (
          <span
            aria-hidden="true"
            className="rating-star-frame"
            // Fixed-length decorative list: the stars have no identity beyond
            // their position, and the array never reorders.
            // biome-ignore lint/suspicious/noArrayIndexKey: index is the identity here
            key={`rating-star-${index}`}
            style={
              {
                "--star-fill": `${fill * 100}%`,
                "--star-preview-fill": `${previewFill * 100}%`,
              } as CSSProperties
            }
          >
            <StarIcon className="rating-star-empty" />
            <span className="rating-star-fill">
              <StarIcon />
            </span>
          </span>
        );
      })}
    </span>
  );
}

export const BookMetadataStrip = ({
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
)
type RatingControlProps = {
  disabled?: boolean;
  rating: number | null;
  onChange: (rating: number | null) => void;
};

const getPointerRating = (input: HTMLInputElement, clientX: number) => {
  const stars = input.previousElementSibling;
  if (!(stars instanceof HTMLElement)) return null;

  const starFrames = Array.from(
    stars.querySelectorAll<HTMLElement>(".rating-star-frame"),
  );
  if (starFrames.length === 0) return null;

  const hoveredIndex = starFrames.findIndex((star, index) => {
    const bounds = star.getBoundingClientRect();
    return clientX <= bounds.right || index === starFrames.length - 1;
  });
  const hoveredStar = starFrames[hoveredIndex];
  const bounds = hoveredStar.getBoundingClientRect();
  const fraction = clientX < bounds.left + bounds.width / 2 ? 0.5 : 1;

  return hoveredIndex + fraction;
};

const RatingControl = ({ disabled = false, rating, onChange }: RatingControlProps) => {
  const [hoverRating, setHoverRating] = useState<number | null>(null);

  return (
    <div aria-label="Rating" className="rating-control" role="group">
      <div className="rating-slider-wrap">
        <RatingStars
          compact
          previewRating={disabled ? undefined : (hoverRating ?? undefined)}
          rating={rating}
        />
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
          onMouseLeave={() => setHoverRating(null)}
          onMouseMove={(event) => {
            if (disabled) return;
            setHoverRating(getPointerRating(event.currentTarget, event.clientX));
          }}
          onPointerDown={(event) => {
            if (disabled) return;

            const nextRating = getPointerRating(event.currentTarget, event.clientX);
            if (nextRating === null) return;

            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            setHoverRating(nextRating);
            if (nextRating !== rating) onChange(nextRating);
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
};

type BookMetadataEditorProps = {
  book: BookDetail;
  error: string | null;
  saving: boolean;
  onChange: (metadata: UpdateBookMetadataPayload) => void;
};

export const BookMetadataEditor = ({
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
)

const PlaceholderCover = ({ title }: { title: string }) => (
  <div className="book-cover-fallback" aria-hidden="true">
    <span>{title.trim().charAt(0).toUpperCase() || "B"}</span>
  </div>
);

export const BookCover = ({ book, large = false }: { book: BookSummary; large?: boolean }) => (
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
)
