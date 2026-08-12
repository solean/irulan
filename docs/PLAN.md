# Irulan Product Plan

## Goal

Evolve Irulan from a polished EPUB bookshelf and Kindle-delivery MVP into a trustworthy local-first library and reader.

The next work should prioritize data safety and reader correctness over additional visual polish or external integrations.

## Current Strengths

Irulan already provides:

- batch EPUB import with duplicate detection
- bookshelf organization
- title and author search
- sorting, status filtering, grid/list views, and density controls
- read status and ratings
- book detail and delivery history
- a paginated reader with themes, fonts, spacing, keyboard navigation, and resume support
- SMTP configuration and Send to Kindle
- onboarding and bookshelf-specific Kindle destinations
- a sandboxed Electron desktop shell

## Priorities

Status annotations below reflect a code audit on 2026-08-07:

| | Status | Meaning |
| --- | --- | --- |
| 🟢 | `done` / `met` | shipped and verified in code |
| 🟡 | `partial` / `partly met` / `in progress` | some of the requirement exists; the gap is named inline |
| 🔴 | `todo` / `not met` / `not started` / `not satisfied` | no implementation found |

The word is kept alongside the colour so the doc stays readable without colour.

### P0: Data Safety and Trust

#### Library backup and restore — 🔴 todo

Add:

- 🔴 one-click library backup — todo; no backup route exists (`src/server/app.ts` registers books, bookshelves, and settings only)
- 🔴 one-click restore with validation and conflict handling — todo; only the internal `app.db.bak` recovery path in `src/server/db/recovery.ts` exists, and it covers the database alone
- 🟡 automatic rotating backups — partial; a single `app.db.bak` is refreshed once per startup, with no rotation
- 🔴 export of an individual original EPUB — todo; originals are stored at `storage/books/<id>/original.epub` with no export route
- 🟡 a way to reveal the complete library data directory in Finder — partial; `shell.showItemInFolder` reveals one book's EPUB (`electron/main.cjs`), not the data directory

A backup must include the database, original EPUB files, extracted covers, and any future reading data or annotations.

#### Durable database persistence — 🟢 done

SQLite through `better-sqlite3`, in WAL mode with `synchronous = FULL`, so a write is
durable when the statement returns and only the pages it touched are written. Startup
`quick_check`s the primary database and falls back to `app.db.bak` when it cannot be used,
discarding stale `.tmp` files from interrupted restores; the backup itself is refreshed
once per startup by SQLite's online backup, off the request path. Implemented in
`src/server/db/recovery.ts`, wired into `src/server/db/client.ts`, covered by
`src/server/db/recovery.test.ts`.

This replaced a `sql.js` design that serialised and rewrote the entire database file on
every mutation, which froze the event loop for ~62 ms per click on a 42 MB library.

#### Secure SMTP credentials — 🟢 done

Electron encrypts app-managed SMTP passwords with its OS-backed `safeStorage`; SQLite
stores only the encrypted value. The settings API never returns the password. It reports
`hasPassword` and `passwordSource`, while the renderer keeps the password input empty and
uses explicit replace and clear actions.

Blank password updates preserve the current credential. All SMTP fields and password
changes are committed and persisted together. Legacy plaintext `smtp_pass` rows migrate
to encrypted storage in Electron; standalone mode discards the obsolete row when
`SMTP_PASS` supplies its replacement. Environment-based SMTP remains supported when
Electron secure storage is unavailable.

Covered by `src/server/app.test.ts`, which asserts no password leakage, blank-preserve, explicit
replace, clear, legacy plaintext migration, and environment fallback.

### P0: Reading Position and EPUB Correctness

#### Stable reading locations — 🟡 partial

The versioned canonical text-location contract, whitespace normalization, DOM selection
serialization, and quote-context resolver are implemented in `src/shared/types.ts`,
`src/shared/reader-text.ts`, and `src/web/lib/reader-location.ts`. The resolver is covered for
inline selections, equivalent markup, repeated quotes, and changed layout in
`src/web/lib/reader-location.test.ts`.

Reader resume still stores `{ section, page }` in `localStorage`
(`src/web/lib/storage.ts`, `src/web/pages/ReaderPage.tsx`), the books table carries only
`reading_status` and `rating`, and the reader never writes reading state back to the server.

Replace the current `{ section, page }` localStorage position with a stable EPUB location, such as an EPUB CFI or an element/text offset.

Persist reading state in SQLite so it survives browser storage resets and can be included in backups.

Reading state should include:

- 🔴 stable current location — todo
- 🔴 overall completion percentage — todo
- 🔴 last-read timestamp — todo
- 🔴 optional completed timestamp — todo

The UI should provide:

- 🔴 Continue Reading on the bookshelf and book detail page — todo
- 🔴 progress on book cards or list rows — todo; the cover stripe in `bookshelf.css` is a fixed gradient, not stored progress
- 🔴 automatic `unread` to `reading` transition after meaningful reading — todo
- 🔴 optional automatic `finished` transition near the end of the book — todo

Changing the font, spacing, window size, or reader layout must not lose the reader's textual position — 🟡 partial; stable text ranges resolve after layout changes, but reader resume still restores a numeric page.

#### EPUB navigation — 🟡 partial

Represent the EPUB navigation document as a hierarchy instead of presenting every linear spine item as an equal table-of-contents entry.

The parser already walks nested `ol`/`li` and `navPoint` trees, but flattens them into a
`Map<zipPath, label>` and strips `#fragments` (`src/server/services/epub.ts`). The wire type
`BookReaderSection` in `src/shared/types.ts` has no children or anchor field, so the hierarchy
cannot be represented end to end. Fixing this means changing the shared type, the parser, and the
flat TOC render in `src/web/pages/ReaderPage.tsx` together.

Support:

- 🔴 nested navigation entries — todo; structure is discarded after parsing
- 🔴 entries targeting anchors inside a spine document — todo; TOC fragments are stripped, though in-content anchor links do work
- 🟢 EPUB 3 navigation documents — done; labels are extracted and preferred
- 🟢 EPUB 2 NCX files — done; labels are extracted as the fallback
- 🟡 sensible labels only when the EPUB has no usable navigation — partial; `inferSectionLabel` derives title, heading, or filename labels

Do not expose generic `Section N` entries when a valid navigation structure exists — 🔴 not satisfied; `resolveReaderSectionLabels` in `src/web/lib/reader.tsx` manufactures `Section N` for blank, title-like, or repeated labels even when the EPUB has valid navigation.

#### Rendering compatibility — 🟡 partial

Define the supported EPUB surface and handle unsupported books explicitly.

Improve support for:

- 🔴 safe publisher CSS — todo; the whitelist renderer drops `style` and `link` entirely
- 🔴 embedded fonts — todo; no `@font-face` extraction
- 🔴 `lang` and `dir` attributes — todo; never copied onto rendered nodes
- 🔴 right-to-left content — todo
- 🟡 poetry and intentionally spaced text — partial; whitespace is collapsed except inside `pre`
- 🟢 SVG and image-heavy pages — done; `img`, external SVG `image` hrefs, and inline SVG are handled
- 🟡 footnotes and backlinks — partial; generic anchor navigation works, with no footnote semantics or backlinks
- 🔴 MathML where practical — todo

Detect fixed-layout and DRM-protected EPUBs. Either support them correctly or show a clear unsupported-format message instead of producing a broken reading view — 🔴 todo; there is no `rendition:layout`, `encryption.xml`, or `rights.xml` check, and failures surface as a generic reader error.

### P1: Reader Tools

Reader tools are in progress. Stable text locations, canonical linear-spine extraction,
transactional SQLite storage, FTS5 indexing, and the book-search API exist. There are no
bookmark or annotation tables, and the reader does not expose the search UI yet.

#### In-book search — 🟡 partial

`GET /api/books/:id/search` lazily indexes existing books and returns paginated result counts,
chapter labels, bounded snippets, and stable ranges. New imports queue indexing without waiting
on it. Canonical source rows and the synchronized FTS5 index cascade on book deletion. Plain
text queries are length-limited and converted to quoted `AND` terms rather than exposing FTS
operators. Covered by `src/server/services/book-search.test.ts`, migration tests, deletion
tests, and server-browser extraction parity tests.

The reader search panel, keyboard interaction, and navigation to the resolved result range
remain.

Add full-book text search with:

- 🟢 result snippets — done in the API
- 🟢 chapter labels — done in the API
- 🟢 result counts — done in the API
- 🔴 direct navigation to the matched text — todo in the reader UI
- 🔴 keyboard access — todo

Search results must use stable locations so they remain valid after pagination changes.

#### Bookmarks — 🔴 todo

Add named or unnamed bookmarks at stable EPUB locations. Bookmarks must be persisted in SQLite and included in backups.

#### Highlights and notes — 🔴 todo

Add text selection actions for:

- highlighting
- adding a note
- copying text
- optional dictionary or system lookup integration

Annotations must survive font changes, window resizing, and normal EPUB re-pagination.

### P1: Library Metadata — 🔴 todo

Editable metadata is still limited to read status and rating (`UpdateBookMetadataPayload` in
`src/shared/types.ts`, `BookMetadataEditor` in `src/web/components/book.tsx`), and import captures
title, author, and cover only. Add editing for:

- title
- author or authors
- cover
- series and series position
- tags
- language
- description
- ISBN or other identifiers
- publisher and publication date

Import all useful metadata present in the EPUB rather than only the first creator — 🔴 todo; `epub.ts` takes `asArray(metadata.creator)[0]`.

Add bulk editing for common fields such as bookshelf membership, tags, read status, and rating — 🔴 todo; only a single-book PATCH route exists.

### P2: Library Workflows — 🔴 todo

Add multi-select and bulk actions for:

- 🔴 assigning bookshelves — todo
- 🔴 changing read status — todo
- 🔴 adding tags — todo
- 🔴 exporting original EPUBs — todo
- 🟡 deleting books with confirmation — partial; single-book delete confirmation exists, bulk does not

Add ingestion options in this order:

1. 🔴 import a directory recursively — todo; import accepts browser multipart files only
2. 🔴 import or link an existing Calibre library — todo
3. 🔴 optional watched folders — todo
4. 🔴 optional OPDS support — todo

Goodreads integration should remain lower priority than local library import, data portability, and reader correctness.

### P2: Desktop Distribution — 🔴 todo

Add desktop integration after the core data and reader work is reliable:

- 🔴 `.epub` file association — todo; no `open-file` handler and no association in the build config
- 🔴 Open with Irulan — todo
- 🟡 drag EPUBs onto the app or Dock icon — partial; in-app drop targets exist, with no Dock or OS handler
- 🔴 signed and notarized macOS builds — todo; no signing or notarization config
- 🔴 application updates — todo; no `autoUpdater`
- 🟡 a documented library-data location — partial; `electron/main.cjs` defines `userData/data` and `userData/storage`, but they are undocumented
- 🔴 a first-run choice for importing an existing library — todo; onboarding covers first book, SMTP, and Kindle only

## Test and Compatibility Matrix

Eleven test files exist (`src/server/app.test.ts`, `config.test.ts`, `services/epub.test.ts`,
`services/books.delete.test.ts`, `services/books.list.test.ts`, `services/settings.recovery.test.ts`,
`db/recovery.test.ts`, `db/migrations.test.ts`, `lib/storage.test.ts`, `src/web/lib/reader.test.ts`,
`electron/url-policy.test.ts`). What is missing is a permanent EPUB fixture corpus covering
observable behavior rather than implementation details: `epub.test.ts` generates every fixture in
memory with JSZip, and no `.epub` file exists on disk.

Required fixtures:

- 🟡 EPUB 2 with NCX navigation — covered in memory
- 🟡 EPUB 3 with nested navigation — covered in memory; nesting is traversed but not asserted as a hierarchy
- 🔴 complete metadata and cover — todo as a single corpus fixture
- 🟡 missing title, author, or cover — covered in memory
- 🟡 multiple creators — covered in memory; asserts only the first creator is kept
- 🔴 SVG cover — todo; cover tests use PNG and JPEG only
- 🔴 internal anchor links and footnotes — todo; `reader.test.ts` exercises the URL resolver, not an EPUB
- 🔴 embedded fonts and publisher CSS — todo
- 🔴 right-to-left content — todo
- 🔴 image-heavy content — todo
- 🔴 fixed-layout EPUB — todo
- 🟡 malformed archive — covered in memory
- 🔴 excessive archive expansion or zip bomb — todo; the entry and uncompressed-byte caps in `epub.ts` have no test
- 🔴 duplicate file import — todo; only the concurrent duplicate API test exists

Required integration coverage:

- 🔴 import stores the original file and metadata — todo as an end-to-end test
- 🟢 duplicate import does not create a second book — done (`app.test.ts`)
- 🔴 backup and restore reproduce the complete library — todo; blocked on the feature
- 🟢 interrupted persistence leaves a recoverable database — done (`db/recovery.test.ts`)
- 🔴 reading location survives font and window changes — todo
- 🟢 deletion removes the intended book and related records — done (`books.delete.test.ts`)
- 🟢 SMTP secrets are never returned by the API — done (`app.test.ts`)
- 🔴 Kindle delivery records success and failure accurately — todo; no delivery tests exist

## Delivery Sequence

### Phase 1: Trust — 🟡 in progress

- 🟢 implement durable database persistence (done)
- 🔴 implement backup, restore, and EPUB export (todo)
- 🟢 move SMTP secrets to Keychain (done)
- 🟢 add credential tests (done)
- 🟢 migrate to native SQLite with transactions and WAL (done)

Exit criteria:

- 🟢 the library survives an interrupted database write — met
- 🔴 a backup restores books, metadata, shelves, settings, and originals — not met
- 🟢 no settings response contains the SMTP password — met

### Phase 2: Reading State — 🔴 not started

- 🔴 introduce stable EPUB locations (todo)
- 🔴 persist reading progress in SQLite (todo)
- 🔴 add Continue Reading and overall progress (todo)
- 🔴 automate read-status transitions conservatively (todo)

Exit criteria:

- 🔴 reopening a book returns to the same text after resizing or changing typography — not met
- 🔴 progress is visible from the bookshelf — not met
- 🔴 progress is included in backup and restore — not met

### Phase 3: EPUB Compatibility — 🟡 in progress

- 🔴 preserve the real navigation hierarchy (todo; labels are extracted, structure is discarded)
- 🔴 expand safe EPUB rendering support (todo; images and SVG only today)
- 🔴 detect unsupported fixed-layout and DRM books (todo)
- 🔴 establish the EPUB fixture suite (todo; in-memory specs only)

Exit criteria:

- 🟡 EPUB 2 and EPUB 3 navigation fixtures render correctly — partly met; labels resolve, hierarchy does not
- 🔴 nested entries and anchor targets work — not met
- 🔴 unsupported books fail with a specific, user-readable explanation — not met

### Phase 4: Reader Tools — 🟡 in progress

See the focused [Reader Tools Plan](reader-tools.md).

- 🟡 add in-book search (partial; server indexing and API are done, reader UI remains)
- 🔴 add bookmarks (todo)
- 🔴 add highlights and notes (todo)

Exit criteria:

- 🟡 every saved or searched location remains stable across pagination changes — partial; search returns stable text ranges, but result navigation is not wired into the reader
- 🔴 annotations are persisted and backed up — not met

### Phase 5: Library Depth — 🔴 not started

- 🔴 add richer metadata and cover editing (todo)
- 🔴 add multi-select and bulk actions (todo)
- 🔴 add folder and Calibre-library import (todo)

Exit criteria:

- 🔴 incorrect imported metadata can be fully corrected in the app — not met
- 🔴 common library changes do not require editing books one at a time — not met
- 🔴 an existing collection can be migrated without manually selecting every EPUB — not met

### Phase 6: Distribution — 🔴 not started

- 🔴 add file associations and desktop import entry points (todo)
- 🔴 sign and notarize releases (todo)
- 🔴 add application updates (todo)

Exit criteria:

- 🔴 opening an EPUB from Finder imports or opens it intentionally — not met
- 🔴 users can install and update the app without bypassing macOS security warnings — not met

## Backlog Cleanup

The existing `todo.md` is stale:

- SMTP configuration and secure credential storage are complete, including credential tests.
- ratings and manual completion status are implemented; stable automatic reading progress remains.
- onboarding is implemented.
- Calibre or folder import remains valuable and should precede Goodreads integration.
- Goodreads integration is optional and should not block the phases above.
