# Irulan

A local-first, single-user EPUB manager focused on:

- importing EPUB files
- browsing a clean bookshelf
- reading EPUBs in the browser
- sending a selected EPUB to a Kindle email address

This project intentionally does not do format conversion.

## Stack

- Node.js 24+ (Bun is the package manager; the server and tests run on Node)
- Hono
- React + Vite
- SQLite via better-sqlite3 + Drizzle
- Electron for macOS desktop packaging

## Run It

1. Copy `.env.example` to `.env`.
2. If `5173` is busy, set `WEB_PORT` to another port in `.env`.
3. If you expect large uploads or slower disks, raise `SERVER_IDLE_TIMEOUT_SECONDS`.
4. Fill in your SMTP values.
5. Run:

```bash
bun install
bun run dev
```

The app runs at:

- web UI: `http://localhost:<WEB_PORT>`
- API: `http://localhost:8787`

Example:

```bash
WEB_PORT=4173 bun run dev
```

The API server defaults `SERVER_IDLE_TIMEOUT_SECONDS` to `120` so EPUB uploads and import processing are not cut off by the runtime's default 10 second socket timeout.

## Build

```bash
bun run build
bun run start
```

## Test

```bash
bun run test
bun run check
```

`bun run test` runs the Vitest suite. `bun run check` type-checks with `tsc` and then lints
with Biome; `bun run lint` runs the linter on its own. Formatting is deliberately not
enforced.

## macOS Desktop

Run the Electron app locally:

```bash
bun run electron
```

Build a packaged macOS app:

```bash
bun run electron:pack
```

Create distributable macOS artifacts:

```bash
bun run electron:dist
```

The desktop app stores its library data under the app's macOS Application Support directory instead of the repo-local `data/` and `storage/` folders.

## Kindle Delivery

To send books to Kindle:

1. Find your Kindle email address in Amazon's Kindle settings.
2. Add your sender email to Amazon's approved personal document sender list.
3. Save the Kindle address in the app settings.
4. Send an imported EPUB from the detail page.

SMTP success only confirms the email was accepted by your SMTP server. Amazon may still reject it afterward if the sender is not approved.

## Data Layout

Local app data is stored under:

- `data/app.db`
- `data/app.db.bak`
- `storage/books/<book-id>/original.epub`
- `storage/books/<book-id>/cover.*`
- `storage/books/<book-id>/reader/manifest.json` — the reader's section list. Section and
  asset bytes are read out of `original.epub` on request, so nothing is unpacked to disk.
  Content extracted by older builds is removed on the next start.
- `storage/.trash/` — where a deleted book's files wait until its rows are gone, so a
  failed delete can put them back. On startup, files belonging to books still in the
  catalog are restored; files from committed deletions are removed.
- `data/.library-restore.json` — a temporary restore journal. Startup uses it to
  recover an interrupted restore before opening the catalog.

You can override the storage locations with:

- `EBOOK_DATA_DIR`
- `EBOOK_STORAGE_DIR`

## Database Durability

SQLite writes use WAL mode with `synchronous = FULL`. Commits flush the WAL to disk;
a clean shutdown checkpoints it into `data/app.db`. After an interrupted process,
SQLite replays the WAL on the next open. Do not copy only `app.db` while the app is
running: committed changes may still be in its `-wal` sidecar.

On startup the primary database passes SQLite's `quick_check`. If it is missing
or unreadable, Irulan restores the last usable `data/app.db.bak` and displays a
recovery notice. The recovery copy is refreshed with SQLite's online backup once
per startup and after a library restore, not after every save. Recovery can
therefore lose changes made since that snapshot. An unusable existing database
without a valid backup stops startup; a fresh installation creates an empty database.

## Library Backup and Restore

Settings provides a complete-library ZIP backup containing the database, original
EPUBs, covers, shelves, settings, delivery history, bookmarks, annotations, and
reading positions. Reading positions live in SQLite and survive desktop restarts;
older browser-local positions migrate when no library position is saved.

Restore validates archive paths, file sizes and hashes, and the database before
replacing the library. A restore journal retains the previous catalog and book
files until the replacement is committed. If interrupted, startup rolls back an
uncommitted restore or finishes cleanup for a committed one. Recovery failures
stop startup and preserve recovery files for inspection.

The automatic `app.db.bak` covers only the catalog. Use the complete-library ZIP
backup to protect EPUBs and covers too. SMTP passwords encrypted by the operating
system may need to be entered again when restoring on another machine.
