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

The stable-location primitive is implemented: shared versioned types, canonical whitespace
normalization, DOM selection serialization, and quote-context range resolution. Canonical
server-side text extraction walks every linear spine section in reading order and mirrors the
web renderer. SQLite stores that derived text and keeps an FTS5 index synchronized. New imports
queue indexing without delaying import responses; existing books index lazily on first search.
The search API returns counts, chapter labels, bounded snippets, and stable ranges. Reader UI,
bookmarks, highlights, and notes remain.

## Delivery

1. **Stable locations — done.** Shared location types, deterministic EPUB text normalization,
   and DOM-range serialization and resolution are implemented and verified independently of
   font, spacing, viewport, and pagination changes.
2. **In-book search — server complete.** Canonical extraction, transactional SQLite storage,
   FTS5 indexing, import indexing, lazy backfill, plain-text query handling, pagination, and
   stable result ranges are implemented. Next, add the reader search panel with `Cmd/Ctrl+F`,
   arrow-key navigation, `Escape`, and direct navigation to the resolved result range.
3. **Bookmarks** — persist an optional label and stable location. Add actions to create a bookmark at the current position, rename it, jump to it, and delete it.
4. **Highlights and notes** — add a text-selection toolbar for highlight, note, and copy. Persist the stable range, selected quote, colour, and optional note. Paint resolved DOM ranges without changing document layout.
5. **Hardening** — cascade reader-tool records when a book is deleted, include them in library backups, limit search queries and snippets, and cover the flows with a multi-section EPUB fixture.

Start with search as the first vertical slice. It proves text normalization, indexing, stable navigation, the API, and reader UI before the more complex selection interactions.

## Exit Criteria

- Search covers the complete linear spine and opens the matched text.
- Search results and saved locations survive repagination.
- Bookmarks, highlights, and notes survive reload and library restore.
- All reader tools are usable by keyboard.
