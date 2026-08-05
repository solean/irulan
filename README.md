# Irulan

A local-first, single-user EPUB manager focused on:

- importing EPUB files
- browsing a clean bookshelf
- reading EPUBs in the browser
- sending a selected EPUB to a Kindle email address

This project intentionally does not do format conversion.

## Stack

- Node.js
- Hono
- React + Vite
- SQLite + Drizzle
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

The Bun API server defaults `SERVER_IDLE_TIMEOUT_SECONDS` to `120` so EPUB uploads and import processing are not cut off by the runtime's default 10 second socket timeout.

## Build

```bash
bun run build
bun run start
```

## Test

```bash
bun test
bun run check
```

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
- `storage/books/<book-id>/reader/`
- `storage/.trash/` — where a deleted book's files wait until its rows are gone, so a
  failed delete can put them back. Emptied on every start, so anything a crash left
  behind is cleaned up rather than accumulating.

You can override the storage locations with:

- `EBOOK_DATA_DIR`
- `EBOOK_STORAGE_DIR`

## Database Durability

Writes to `data/app.db` never modify the live file in place. Every save:

1. exports the database and verifies it with `PRAGMA integrity_check`
2. writes the bytes to `data/app.db.tmp` and flushes them to disk
3. rotates the previous known-good database to `data/app.db.bak`
4. atomically renames the temporary file over `data/app.db`

If the app is killed mid-save, the interrupted `.tmp` file is discarded on the
next start and the committed database is used unchanged.

On startup the primary database is opened and integrity-checked. If it is
missing or unreadable, Irulan restores `data/app.db.bak`, logs
`Recovered Irulan database from …`, and continues. Recovery rolls the library
back to the state before the last successful save. If neither file is valid,
startup fails loudly instead of silently creating an empty library.

Only the SQLite catalog is covered. Imported EPUBs, covers, and extracted
reader content under `storage/` are not yet backed up — see `docs/PLAN.md`.
