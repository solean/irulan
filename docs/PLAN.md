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

### P0: Data Safety and Trust

#### Library backup and restore

Add:

- one-click library backup
- one-click restore with validation and conflict handling
- automatic rotating backups
- export of an individual original EPUB
- a way to reveal the complete library data directory in Finder

A backup must include the database, original EPUB files, extracted covers, and any future reading data or annotations.

#### Durable database persistence — done

Implemented in `src/server/db/persistence.ts` and wired into
`src/server/db/client.ts`. Every save validates the exported bytes, writes them
to a temporary file, flushes the file and its parent directory, rotates the
previous known-good database to `app.db.bak`, and atomically renames the
temporary file over `app.db`. Startup integrity-checks the primary database and
falls back to the backup, discarding stale `.tmp` files from interrupted writes.
Covered by `src/server/db/persistence.test.ts`.

Still open: migrating from SQL.js to native SQLite with transactions and WAL, so
a save no longer rewrites the whole database file.

#### Secure SMTP credentials — done

Electron encrypts app-managed SMTP passwords with its OS-backed `safeStorage`; SQLite
stores only the encrypted value. The settings API never returns the password. It reports
`hasPassword` and `passwordSource`, while the renderer keeps the password input empty and
uses explicit replace and clear actions.

Blank password updates preserve the current credential. All SMTP fields and password
changes are committed and persisted together. Legacy plaintext `smtp_pass` rows migrate
to encrypted storage in Electron; standalone mode discards the obsolete row when
`SMTP_PASS` supplies its replacement. Environment-based SMTP remains supported when
Electron secure storage is unavailable.

### P0: Reading Position and EPUB Correctness

#### Stable reading locations

Replace the current `{ section, page }` localStorage position with a stable EPUB location, such as an EPUB CFI or an element/text offset.

Persist reading state in SQLite so it survives browser storage resets and can be included in backups.

Reading state should include:

- stable current location
- overall completion percentage
- last-read timestamp
- optional completed timestamp

The UI should provide:

- Continue Reading on the bookshelf and book detail page
- progress on book cards or list rows
- automatic `unread` to `reading` transition after meaningful reading
- optional automatic `finished` transition near the end of the book

Changing the font, spacing, window size, or reader layout must not lose the reader's textual position.

#### EPUB navigation

Represent the EPUB navigation document as a hierarchy instead of presenting every linear spine item as an equal table-of-contents entry.

Support:

- nested navigation entries
- entries targeting anchors inside a spine document
- EPUB 3 navigation documents
- EPUB 2 NCX files
- sensible labels only when the EPUB has no usable navigation

Do not expose generic `Section N` entries when a valid navigation structure exists.

#### Rendering compatibility

Define the supported EPUB surface and handle unsupported books explicitly.

Improve support for:

- safe publisher CSS
- embedded fonts
- `lang` and `dir` attributes
- right-to-left content
- poetry and intentionally spaced text
- SVG and image-heavy pages
- footnotes and backlinks
- MathML where practical

Detect fixed-layout and DRM-protected EPUBs. Either support them correctly or show a clear unsupported-format message instead of producing a broken reading view.

### P1: Reader Tools

#### In-book search

Add full-book text search with:

- result snippets
- chapter labels
- result counts
- direct navigation to the matched text
- keyboard access

Search results must use stable locations so they remain valid after pagination changes.

#### Bookmarks

Add named or unnamed bookmarks at stable EPUB locations. Bookmarks must be persisted in SQLite and included in backups.

#### Highlights and notes

Add text selection actions for:

- highlighting
- adding a note
- copying text
- optional dictionary or system lookup integration

Annotations must survive font changes, window resizing, and normal EPUB re-pagination.

### P1: Library Metadata

The current editable metadata is limited to read status and rating. Add editing for:

- title
- author or authors
- cover
- series and series position
- tags
- language
- description
- ISBN or other identifiers
- publisher and publication date

Import all useful metadata present in the EPUB rather than only the first creator.

Add bulk editing for common fields such as bookshelf membership, tags, read status, and rating.

### P2: Library Workflows

Add multi-select and bulk actions for:

- assigning bookshelves
- changing read status
- adding tags
- exporting original EPUBs
- deleting books with confirmation

Add ingestion options in this order:

1. import a directory recursively
2. import or link an existing Calibre library
3. optional watched folders
4. optional OPDS support

Goodreads integration should remain lower priority than local library import, data portability, and reader correctness.

### P2: Desktop Distribution

Add desktop integration after the core data and reader work is reliable:

- `.epub` file association
- Open with Irulan
- drag EPUBs onto the app or Dock icon
- signed and notarized macOS builds
- application updates
- a documented library-data location
- a first-run choice for importing an existing library

## Test and Compatibility Matrix

There are currently no automated tests. Add a permanent EPUB fixture corpus covering observable behavior rather than implementation details.

Required fixtures:

- EPUB 2 with NCX navigation
- EPUB 3 with nested navigation
- complete metadata and cover
- missing title, author, or cover
- multiple creators
- SVG cover
- internal anchor links and footnotes
- embedded fonts and publisher CSS
- right-to-left content
- image-heavy content
- fixed-layout EPUB
- malformed archive
- excessive archive expansion or zip bomb
- duplicate file import

Required integration coverage:

- import stores the original file and metadata
- duplicate import does not create a second book
- backup and restore reproduce the complete library
- interrupted persistence leaves a recoverable database
- reading location survives font and window changes
- deletion removes the intended book and related records
- SMTP secrets are never returned by the API
- Kindle delivery records success and failure accurately

## Delivery Sequence

### Phase 1: Trust

- ~~implement durable database persistence~~ (done)
- implement backup, restore, and EPUB export
- move SMTP secrets to Keychain
- add credential tests
- migrate to native SQLite with transactions and WAL

Exit criteria:

- the library survives an interrupted database write
- a backup restores books, metadata, shelves, settings, and originals
- no settings response contains the SMTP password

### Phase 2: Reading State

- introduce stable EPUB locations
- persist reading progress in SQLite
- add Continue Reading and overall progress
- automate read-status transitions conservatively

Exit criteria:

- reopening a book returns to the same text after resizing or changing typography
- progress is visible from the bookshelf
- progress is included in backup and restore

### Phase 3: EPUB Compatibility

- preserve the real navigation hierarchy
- expand safe EPUB rendering support
- detect unsupported fixed-layout and DRM books
- establish the EPUB fixture suite

Exit criteria:

- EPUB 2 and EPUB 3 navigation fixtures render correctly
- nested entries and anchor targets work
- unsupported books fail with a specific, user-readable explanation

### Phase 4: Reader Tools

- add in-book search
- add bookmarks
- add highlights and notes

Exit criteria:

- every saved or searched location remains stable across pagination changes
- annotations are persisted and backed up

### Phase 5: Library Depth

- add richer metadata and cover editing
- add multi-select and bulk actions
- add folder and Calibre-library import

Exit criteria:

- incorrect imported metadata can be fully corrected in the app
- common library changes do not require editing books one at a time
- an existing collection can be migrated without manually selecting every EPUB

### Phase 6: Distribution

- add file associations and desktop import entry points
- sign and notarize releases
- add application updates

Exit criteria:

- opening an EPUB from Finder imports or opens it intentionally
- users can install and update the app without bypassing macOS security warnings

## Backlog Cleanup

The existing `todo.md` is partially stale:

- SMTP configuration is substantially implemented; remaining work is secure storage and reliability coverage.
- ratings and manual completion status are implemented; stable automatic reading progress remains.
- onboarding is implemented.
- Calibre or folder import remains valuable and should precede Goodreads integration.
- Goodreads integration is optional and should not block the phases above.
