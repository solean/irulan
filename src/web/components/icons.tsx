import { cn } from "@/lib/utils";

import type { SortDirection } from "../../shared/types";

// App-specific SVG icons.
export const BookIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 3h4.5a2 2 0 0 1 2 2v9a1.5 1.5 0 0 0-1.5-1.5H2V3Z" />
    <path d="M14 3H9.5a2 2 0 0 0-2 2v9A1.5 1.5 0 0 1 9 12.5H14V3Z" />
  </svg>
)

export const ArrowLeftIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M10 12 6 8l4-4" />
  </svg>
)

export const GridIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h4v4h-4z" />
  </svg>
)

export const ListIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 4h10M3 8h10M3 12h10" />
    <path d="M1.5 4h.01M1.5 8h.01M1.5 12h.01" />
  </svg>
)

export const DensityComfortableIcon = () => (
  <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect height="6" rx="1.2" width="6" x="1.5" y="1.5" />
    <rect height="6" rx="1.2" width="6" x="8.5" y="1.5" />
    <rect height="6" rx="1.2" width="6" x="1.5" y="8.5" />
    <rect height="6" rx="1.2" width="6" x="8.5" y="8.5" />
  </svg>
)

export const DensityCompactIcon = () => (
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
)


export const ContentsIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 4h12M2 8h12M2 12h9" />
  </svg>
)

export const ChevronLeftIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
)

export const ChevronRightIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
)

export const ListComfortableIcon = () => (
  <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect height="3.5" rx="0.8" width="13" x="1.5" y="2" />
    <rect height="3.5" rx="0.8" width="13" x="1.5" y="10.5" />
  </svg>
)

export const ListCompactIcon = () => (
  <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect height="1.6" rx="0.5" width="13" x="1.5" y="2" />
    <rect height="1.6" rx="0.5" width="13" x="1.5" y="5" />
    <rect height="1.6" rx="0.5" width="13" x="1.5" y="8" />
    <rect height="1.6" rx="0.5" width="13" x="1.5" y="11" />
  </svg>
)

export const SortIcon = ({
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
)

export const UploadIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 16V5" />
    <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
    <path d="M5 19h14" />
  </svg>
)

export const PlayIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5.5 3.4 12 8l-6.5 4.6z" fill="currentColor" stroke="none" />
  </svg>
)

export const MoreIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
  </svg>
)

export const CopyIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect height="9" rx="1.5" width="9" x="5" y="5" />
    <path d="M3 11V4a1 1 0 0 1 1-1h7" />
  </svg>
)

export const FolderIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 4.5h4l1.3 1.5h5.7v6.5a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" />
    <path d="M2 7h12" />
  </svg>
)

export const EditIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m10.5 3 2.5 2.5L6 12.5H3.5V10z" />
  </svg>
)

export const MailIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect height="10" rx="1.5" width="13" x="1.5" y="3" />
    <path d="m2 4 6 5 6-5" />
  </svg>
)

export const CheckIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
)
