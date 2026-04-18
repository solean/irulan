# Irulan

A local-first, single-user EPUB manager focused on:

- importing EPUB files
- browsing a clean bookshelf
- reading EPUBs in the browser
- sending a selected EPUB to a Kindle email address

This project intentionally does not do format conversion.

## Stack

- Bun
- Hono
- React + Vite
- SQLite + Drizzle

## Run It

1. Copy `.env.example` to `.env`.
2. If `5173` is busy, set `WEB_PORT` to another port in `.env`.
3. Fill in your SMTP values.
4. Run:

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

## Build

```bash
bun run build
bun run start
```

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
- `storage/books/<book-id>/original.epub`
- `storage/books/<book-id>/cover.*`
- `storage/books/<book-id>/reader/`

You can override the storage locations with:

- `EBOOK_DATA_DIR`
- `EBOOK_STORAGE_DIR`
