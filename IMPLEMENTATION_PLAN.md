# Irulan: Implementation Plan

## Goal

Build a small, local-first alternative to Calibre focused on three jobs:

1. Import EPUB files.
2. Browse a personal bookshelf.
3. Send a selected EPUB to a Kindle via email.

This project is intentionally not an ebook conversion tool.

## Product Scope

### MVP Features

- Import one or more `.epub` files from the UI.
- Extract and store basic metadata:
  - title
  - author
  - cover image
- Show a bookshelf/grid of imported books.
- Search books by title or author.
- View a simple book detail page.
- Configure Kindle delivery settings.
- Send a selected EPUB as an email attachment to a Kindle address.
- Record delivery history and failure reasons.

### Explicit Non-Goals For v1

- Format conversion of any kind
- Support for non-EPUB formats
- Library sync across devices
- User accounts or multi-user support
- Metadata editing UI
- Tags, series, collections, or shelves
- In-browser reading
- OPDS, Kobo, USB device transfer, or Kindle API integrations

## Product Assumptions

- This is a single-user app running on one machine.
- EPUB files are treated as canonical source files and stored unchanged.
- Kindle delivery is done through Amazon's personal document email workflow.
- The user is responsible for:
  - knowing their Kindle email address
  - approving the sender address in Amazon's Kindle settings

## Technical Direction

Use a minimal local web app with Bun as the primary runtime and package manager.

### Proposed Stack

- Runtime and package manager: Bun
- API/server: Hono
- Frontend: React + Vite
- Database: SQLite
- ORM/migrations: Drizzle ORM + Drizzle Kit
- Email delivery: SMTP transport
- EPUB parsing: ZIP + XML parsing of EPUB package metadata

### Why This Shape

- Bun keeps install, scripts, and runtime simple.
- SQLite is the correct default for a local single-user library.
- A normal web UI is easier to iterate on than a desktop wrapper.
- Keeping the server local avoids cloud infrastructure and credential handling complexity.
- Parsing EPUB metadata directly is much smaller than adopting a full ebook management stack.

## Desktop Strategy

Do not build this as a native macOS app in v1.

Build it first as a local web app, but keep the architecture compatible with a future desktop wrapper.

### What To Preserve Now

- Keep all file system, database, EPUB parsing, and SMTP logic in server-only modules.
- Keep the frontend as a pure client UI that talks to a local API.
- Avoid browser-only assumptions for file paths, storage roots, and config locations.
- Use an app-owned data directory abstraction instead of hardcoding random paths throughout the codebase.
- Keep import, send, and metadata logic independent of the transport layer so it can later run behind:
  - a local HTTP server
  - a Tauri sidecar/bundled backend
  - an Electron main-process backend

### Why Not Optimize For Desktop Yet

- Desktop packaging adds signing, bundling, app lifecycle, and auto-update concerns that do not help validate the product.
- The core product risk is import quality and Kindle delivery, not shell packaging.
- A local web app will let us iterate on the real workflows faster.

### Likely Future Path

If the app earns a desktop shell later, the cleanest path is to keep the current app structure and add a thin desktop wrapper around it.

That wrapper could:

- bundle the frontend
- launch the local backend as a managed process
- expose native file dialogs and app-level configuration

The main codebase should not need a rewrite if we preserve the separation above.

## High-Level Architecture

There are four main subsystems:

1. Library storage
2. Metadata import pipeline
3. Web UI
4. Kindle delivery service

### Library Storage

- Store original EPUBs on disk under an app-managed storage root.
- Store extracted covers separately for fast bookshelf rendering.
- Store metadata and delivery history in SQLite.

Suggested layout:

```text
storage/
  books/
    <book-id>/
      original.epub
      cover.jpg
data/
  app.db
```

### Metadata Import Pipeline

On upload:

1. Read the file and compute a SHA-256 hash.
2. Reject exact duplicates by file hash.
3. Open the EPUB as a ZIP archive.
4. Read `META-INF/container.xml` to locate the OPF package file.
5. Parse the OPF metadata for title, creator, identifiers, and manifest.
6. Find a cover image if one is declared.
7. Copy the EPUB into managed storage.
8. Extract and persist the cover image if available.
9. Insert a `books` record into SQLite.

Fallback behavior:

- If title is missing, derive it from the filename.
- If author is missing, store `Unknown Author`.
- If no cover exists, render a generated placeholder in the UI.

### Web UI

Initial screens:

- Bookshelf page
- Book detail page
- Settings page

Bookshelf page responsibilities:

- grid/list of books
- search box
- add-books action
- per-book quick actions

Book detail page responsibilities:

- cover
- title and author
- file info
- send-to-Kindle action
- delivery history

Settings page responsibilities:

- sender email
- SMTP host/port/username
- SMTP password
- default Kindle address
- optional test-send action

### Kindle Delivery Service

The app sends the original EPUB as an email attachment via SMTP.

Delivery flow:

1. User clicks send on a book.
2. App creates a delivery record with status `pending`.
3. App sends an email with the EPUB attached.
4. App updates the delivery record to `sent` or `failed`.

Important limitation:

- `sent` should mean "accepted by the SMTP server", not "confirmed delivered by Amazon".
- Amazon-side rejection due to sender approval or document policy may happen after SMTP acceptance.
- v1 should expose this limitation clearly in the UI.

## Data Model

Keep the schema intentionally flat.

### `books`

- `id`
- `title`
- `author`
- `file_path`
- `cover_path`
- `file_hash`
- `source_filename`
- `file_size_bytes`
- `imported_at`

### `deliveries`

- `id`
- `book_id`
- `recipient_email`
- `status`
- `smtp_message_id`
- `error_message`
- `created_at`
- `sent_at`

### `settings`

- `key`
- `value`

## Settings Strategy

Separate secrets from normal app preferences.

### Secrets

Store SMTP credentials in environment variables or a local `.env` file:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

### App Settings

Store non-secret settings in SQLite:

- default Kindle recipient address
- preferred send target
- UI preferences if needed later

This avoids building secret-management UI in the MVP.

## API Plan

Initial endpoints:

- `POST /api/books/import`
- `GET /api/books`
- `GET /api/books/:id`
- `POST /api/books/:id/send`
- `GET /api/books/:id/deliveries`
- `GET /api/settings`
- `PUT /api/settings`
- `POST /api/settings/test-email`

### Response Principles

- Return small JSON payloads optimized for the bookshelf UI.
- Keep errors explicit and user-readable.
- Distinguish validation failures from operational failures.

## UI Plan

### Bookshelf

- Responsive grid of covers
- Search input at top
- Empty state with upload CTA
- Import progress and duplicate reporting

### Book Card

- Cover image or placeholder
- Title
- Author
- Quick send button

### Book Detail

- Larger cover
- File metadata
- Import timestamp
- Send form with editable recipient
- Delivery history table

### Settings

- SMTP configuration status
- Sender address explanation
- Kindle email help text
- "Approved sender" reminder

## Error Handling

Expected user-facing failure cases:

- invalid file type
- malformed EPUB
- duplicate file
- missing SMTP config
- SMTP auth failure
- network timeout
- Amazon rejection not guaranteed visible in-band

The UI should present actionable messages, not stack traces.

## Testing Strategy

### Unit Tests

- EPUB metadata extraction
- duplicate detection
- settings validation
- send request validation

### Integration Tests

- import endpoint stores file and DB row
- list endpoint returns expected bookshelf shape
- send endpoint records `sent` or `failed`

### Manual Test Matrix

- EPUB with complete metadata
- EPUB with missing author
- EPUB with no cover
- duplicate upload
- valid SMTP test send
- failed SMTP credentials
- Kindle send with approved sender

## Delivery Milestones

### Milestone 0: Foundation

- initialize Bun project
- add Hono, React, Vite, SQLite, Drizzle
- define storage root conventions
- define environment configuration

Exit criteria:

- app boots locally
- database can be created
- basic frontend can load

### Milestone 1: Import Pipeline

- file upload endpoint
- EPUB metadata extraction
- cover extraction
- file persistence
- duplicate detection

Exit criteria:

- importing a valid EPUB creates a book record and visible cover card

### Milestone 2: Bookshelf UI

- bookshelf grid
- search/filter
- empty state
- book detail page

Exit criteria:

- imported books are browseable and searchable

### Milestone 3: Kindle Delivery

- settings management
- SMTP integration
- send action
- delivery history

Exit criteria:

- user can send an imported EPUB to a configured Kindle address

### Milestone 4: Hardening

- improve error messages
- add import/send tests
- add logging
- polish UX around duplicates and failures

Exit criteria:

- happy path and common failure cases are covered by tests and clear UI states

## Recommended Repo Layout

```text
src/
  server/
    db/
    routes/
    services/
    lib/
  web/
    components/
    routes/
    lib/
  shared/
storage/
data/
```

Alternative:

- keep `server/` and `web/` as separate top-level directories if that feels cleaner during setup

Either is acceptable. The important constraint is to keep EPUB parsing, mail delivery, and storage access in server-only code.

## Implementation Order

1. Scaffold app and database.
2. Implement EPUB parsing in isolation with fixtures.
3. Implement import endpoint and on-disk storage.
4. Build bookshelf UI against real API responses.
5. Add detail page and delivery history.
6. Add SMTP send flow and settings.
7. Add tests and tighten failures.

## Open Questions

These do not block implementation, but should be decided early:

- Should SMTP settings live only in `.env`, or do you want a settings UI that can persist them locally?
- Should the app support multiple Kindle recipient addresses, or just one default?
- Do you want drag-and-drop import only, or also watch a local folder later?
- Should duplicate detection be strict by file hash only, or should we also flag same title/author as possible duplicates?

## Recommended MVP Decisions

To keep momentum high, use these defaults:

- one local user
- local-first architecture
- one default Kindle address
- SMTP credentials from `.env`
- duplicate detection by file hash only
- no background queue
- no metadata editing UI
- web app first, desktop wrapper later only if needed

## Success Criteria

The MVP is successful when a user can:

1. Open the app locally.
2. Import a handful of EPUBs.
3. See a clean bookshelf with covers and titles.
4. Search the library.
5. Send a selected book to their Kindle email address with one action.

## First Build Step

Start with Milestone 0 and Milestone 1 together:

- scaffold the Bun app
- wire SQLite and Drizzle
- implement EPUB metadata extraction with fixture tests

That path de-risks the core of the product early. If import is solid, the rest of the app is straightforward.
