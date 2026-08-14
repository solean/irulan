# Reader Tools Plan

## Goal

Add full-book search, bookmarks, highlights, and notes without tying saved data to the reader's current pagination.

## Foundation

Reader tools depend on the stable-location work in Phase 2 of the product plan. Use one shared location shape for progress, search results, bookmarks, and annotations:

- spine-section href
- normalized text start and end offsets
- exact selected text with short prefix and suffix context

Offsets provide fast lookup; quote context can re-anchor a location if text normalization changes. Never persist page numbers.

## Status

Complete. Stable, versioned text locations are shared by reading progress, search results,
bookmarks, and annotations. Canonical extraction covers every linear spine section and keeps
SQLite source rows and FTS5 search data synchronized. The reader exposes full-book search,
bookmark management, and selection actions for highlights, notes, and copying text. Saved
ranges re-anchor from quote context, and CSS Highlight painting does not alter document layout.

Reader-tool rows cascade with book deletion and are included with the database, original EPUBs,
and covers in validated library backup and restore. Query, pagination, snippet, label, note,
quote, upload, archive, and extraction limits are enforced. The multi-section EPUB fixture
covers extraction, search, stable navigation, deletion, backup, and restore.

## Delivery

1. **Stable locations — done.** Shared point and range types, deterministic text normalization,
   viewport-position serialization, DOM selection serialization, and quote-context resolution
   are implemented independently of pagination.
2. **In-book search — done.** Canonical extraction, transactional SQLite storage, FTS5
   indexing, lazy backfill, bounded plain-text queries and snippets, pagination, the reader
   search panel, keyboard controls, and direct stable-range navigation are implemented.
3. **Bookmarks — done.** Named and unnamed bookmarks persist stable locations and can be
   created at the current reading position, renamed, opened, and deleted.
4. **Highlights and notes — done.** The selection toolbar supports colour highlights, notes,
   and copying. A range carries one annotation: highlighting an already highlighted passage
   recolours it instead of stacking a second highlight, enforced by a unique range index.
   Saved annotations can be opened, recoloured, edited, and deleted, and resolved ranges are
   painted without changing pagination.
5. **Hardening — done.** Reader-tool records cascade on book deletion, survive full-library
   backup and restore, enforce bounded inputs, and are covered with a multi-section EPUB.

## Exit Criteria

- Search covers the complete linear spine and opens the matched text.
- Search results and saved locations survive repagination.
- Bookmarks, highlights, and notes survive reload and library restore.
- All reader tools are usable by keyboard.
