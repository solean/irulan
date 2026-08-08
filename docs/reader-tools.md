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
normalization, DOM selection serialization, and quote-context range resolution. It is verified
across inline markup, rerendering, repeated text, and layout changes. Reader progress, search,
bookmarks, and annotations do not use it yet.

## Delivery

1. **Stable locations — done.** Shared location types, deterministic EPUB text normalization,
   and DOM-range serialization and resolution are implemented and verified independently of
   font, spacing, viewport, and pagination changes.
2. **In-book search** — store canonical text per spine section and index it with SQLite FTS5. Index new imports and lazily backfill existing books. Return result counts, chapter labels, snippets, and stable ranges. Add a reader search panel with `Cmd/Ctrl+F`, arrow-key navigation, and `Escape`.
3. **Bookmarks** — persist an optional label and stable location. Add actions to create a bookmark at the current position, rename it, jump to it, and delete it.
4. **Highlights and notes** — add a text-selection toolbar for highlight, note, and copy. Persist the stable range, selected quote, colour, and optional note. Paint resolved DOM ranges without changing document layout.
5. **Hardening** — cascade reader-tool records when a book is deleted, include them in library backups, limit search queries and snippets, and cover the flows with a multi-section EPUB fixture.

Start with search as the first vertical slice. It proves text normalization, indexing, stable navigation, the API, and reader UI before the more complex selection interactions.

## Exit Criteria

- Search covers the complete linear spine and opens the matched text.
- Search results and saved locations survive repagination.
- Bookmarks, highlights, and notes survive reload and library restore.
- All reader tools are usable by keyboard.
