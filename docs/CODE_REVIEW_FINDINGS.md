# Code Review Findings

Findings from a full read of the codebase (server, web client, Electron shell, build
config) on 2026-07-31, plus the follow-up review of the fixes that landed the same day.

Line references were verified against `ab2e4b1`. They will drift — treat them as a
starting point, not gospel. `App.tsx` in particular moves constantly.

Nothing here is a blocker for a local single-user app that works today. The list is
roughly ordered by consequence within each section.

---

## Status summary

| # | Finding | Status |
|---|---|---|
| 1 | Theme pre-paint script read the wrong storage key | Fixed — `441d77c` |
| 2 | `deleteBook` rollback lost shelf memberships | Fixed — `bea269b` |
| 3 | Database writes were non-atomic and unrecoverable | Fixed — `0e0989d` |
| 4 | Save path did 4× redundant integrity checks; bad primary blocked all writes | Fixed — `3b05559` |
| 5 | Failed save leaves memory ahead of disk | **Open — highest priority** |
| 6 | Saves block the event loop | Open (architectural) |
| 7 | Transient memory ~2× database size per save | Open (architectural) |
| 8 | `listBooks` is O(books × shelves) in queries | Fixed — `ab2e4b1` |
| 9 | `shell.openExternal` has no scheme allowlist | Fixed — `abc530b` |
| 10 | Unmatched `/api/*` returns HTML with status 200 | Open |
| 11 | `decodeURIComponent` throws outside try → 500 | Open |
| 12 | One bad zip entry makes a whole book unreadable | Open |
| 13 | LIKE wildcards unescaped in search | Open |
| 14 | `parseNumber` treats empty env var as 0 | Open |
| 15 | No pagination or virtualization | Open |
| 16 | Reader extracts the full zip to disk | Open |
| 17 | Imports buffer in memory, no size cap | Open |
| 18 | SMTP password round-trips to the browser | Open |
| 19 | No CSP; dead Google Fonts preconnect | Open |
| 20 | Database recovery is silent to the user | Open |
| 21 | No cross-process locking | Open |
| 22 | `App.tsx` is 6,648 lines | Open |
| 23 | `routeError` duplicated 3×; `GET /` handlers unguarded | Open |
| 24 | Two sources of schema truth | Open |
| 25 | Thin test coverage, no linter | Open |
| 26 | `.trash` never swept; dead code | Open |

---

## Database layer

The three commits on 2026-07-31 fixed the acute problems: writes are atomic, a corrupt
primary recovers from backup at startup, and the save path no longer does redundant
work. What remains below is a property of keeping the whole database in memory and
rewriting it wholesale — it cannot be repaired inside `persistence.ts`.

### 5. A failed save leaves memory ahead of disk — highest priority

`persistDatabase()` is called at 15 sites, none of them guarded:

```
src/server/db/client.ts:175
src/server/services/settings.ts:29,63
src/server/services/delivery.ts:99,133,142
src/server/services/books.ts:173,238,331
src/server/services/bookshelves.ts:178,207,226,251,265,293
```

The in-memory mutation always happens before the persist. If the persist throws — disk
full, permissions, IO error — the route returns 500 but the in-memory database keeps the
change. The client refetches, sees the change, and it looks like it worked. It silently
vanishes on the next restart.

`3b05559` removed the most likely trigger (a corrupt primary can no longer abort the
save), but `ENOSPC` and `EACCES` are still live. There is no clean repair short of
reloading the in-memory database from disk on every persist failure, which is expensive
and still leaves a window.

### 6. Saves block the event loop

`persistDatabaseAtomically` is synchronous end to end. A 1 ms sampling timer set during a
save never fires once — the whole server is frozen for the duration. Measured median
45 ms on a 39.5 MB database, so every concurrent cover fetch and reader asset request
queues behind a rating click.

### 7. Transient memory is ~2× the database size per save

Measured on a 39.5 MB database: `export()` adds 38 MB, the integrity-check copy adds
another 41 MB. RSS goes 362 MB → 441 MB and back on every save.

### Fix for 5, 6, and 7

All three dissolve with a real SQLite driver, which writes only changed pages, gives real
transactions where a failed write fails atomically, and lets `src/server/db/persistence.ts`
be deleted entirely.

This is a bigger job than it first looks. Drizzle 0.45.2 ships these SQLite drivers:

```
better-sqlite3  bun-sqlite  durable-sqlite  expo-sqlite  op-sqlite  sqlite-core  sqlite-proxy
```

**There is no `node:sqlite` driver.** That rules out the cleanest option and leaves:

- **`better-sqlite3`** — the realistic choice, but it is a native addon and the project has
  two runtimes. `bun run start` executes `dist/server/index.cjs` under plain Node, while
  Electron runs the same bundle under Electron's Node. A build for one ABI will not load in
  the other. electron-builder rebuilds it for the packaged app, but `bun run electron`
  against the repo's `node_modules` needs the Electron-ABI build.
- **`bun-sqlite`** — dev only. Production and Electron are both Node.
- **`sqlite-proxy` + `node:sqlite`** — sidesteps native modules entirely and is arguably the
  better end state, but `node:sqlite` needs Node 22+ (the local toolchain is on v21.7.3) and
  Drizzle's proxy driver is async, which would ripple `await` through every `.get()`,
  `.all()` and `.run()` in the 15 service call sites.

Worth a spike to resolve the ABI question before committing to it. `ensureSchema` in
`src/server/db/client.ts` is raw DDL and would need to move or be re-pointed either way —
see finding 24.

Until that lands, finding 5 stops being throwaway work: if the swap is not near-term, the
reload-in-memory-from-disk-on-persist-failure guard is worth having on its own merits.

### 20. Recovery is silent to the user

`openDatabaseWithRecovery` returns `recoveredFromBackup: true` and
`src/server/db/client.ts:47` turns it into a `console.warn`. If the primary is corrupt at
startup you are rolled back to an older state, losing whatever the last save held, and the
UI says nothing. Needs a product decision on how to surface it (toast, settings banner, or
a field on an API response).

### 21. No cross-process locking

Running `bun run dev` and the packaged Electron app against the same data directory means
two processes doing whole-file writes with no coordination. Last writer wins and silently
discards the other's work.

### Known and deliberate

- `replaceFromBytes` in `persistence.ts` still re-reads and re-validates after writing.
  Redundant, but it runs once on the startup recovery path, so it costs nothing in steady
  state.
- `openDatabaseWithRecovery` carries two near-identical ~30-line recovery blocks that
  could collapse into one.
- The hard-link copy fallback in `rotateBackup` has no test. Simulating a filesystem
  without hard-link support is not portable, and mocking `linkSync` does not work cleanly
  against ESM's immutable bindings. The link path and the failure paths around it are
  covered.

---

## Correctness

### 8. `listBooks` was O(books × shelves) in queries — fixed in `ab2e4b1`

`serializeBook` resolved each book's shelves with its own query, and every shelf that came
back ran a `COUNT(*)` to fill in `bookCount` — several thousand statements for one render.

Fixed by gathering shelf totals once with a `GROUP BY` and fetching memberships for a whole
page of books through `listBookshelvesForBooks`. Measured medians for `listBooks()`:

| library | before | after |
|---|---|---|
| 200 books, 3 shelves | 41 ms | 5 ms |
| 1,000 books, 5 shelves | 182 ms | 13 ms |
| 5,000 books, 8 shelves | 1,623 ms | 47 ms |

Two things worth knowing for future batch queries here:

- Every value in an `IN (…)` list is a bound parameter and SQLite caps how many a statement
  may carry. Seeding 5,000 books in one insert hit `too many SQL variables`, so the
  membership query chunks its `IN` list at 400.
- `bookCount` is a whole-library total, not a count within the current filter. A test pins
  this, because the batched shape makes it easy to accidentally scope it to the page.

### 10. Unmatched `/api/*` returns HTML with status 200

The SPA catch-all at `src/server/app.ts:88` sits behind no API 404 guard. In
`src/web/lib/api.ts`, `response.ok` is true, `response.json()` throws, and the fallback
`{error: …}` object is returned *as* `T` — so callers render undefined fields instead of
surfacing an error.

Fix: `app.all("/api/*", …)` returning JSON 404, registered before the catch-all.

### 11. `decodeURIComponent` throws outside the try

`resolvePublicPath` (`src/server/app.ts:43`) is called at `:76`, outside the `try`. A
request for `/assets/%` produces an uncaught `URIError` → 500 instead of 404.

### 12. One bad zip entry makes a whole book unreadable

`src/server/services/epub.ts:454`: `ensureSafeRelativePath(entry.name)` *throws* inside the
extraction loop, aborting `prepareEpubReader` after `:448` has already `rm`'d the reader
directory. A single odd entry name (absolute path, stray `..`) means the EPUB never opens,
with a 400 that reads like the file is corrupt.

The traversal guard itself is correct — the failure mode is wrong. Skip the entry instead
of throwing.

### 13. LIKE wildcards unescaped in search

`src/server/services/books.ts:85`. Values are parameterized so there is no injection, but
`%` and `_` in a user's query are still LIKE metacharacters. Searching `100%` or `a_b`
silently over-matches.

### 14. `parseNumber` treats an empty env var as 0

`src/server/config.ts:9`: `Number(value ?? fallback)` never reaches the fallback for `""`,
and `Number("")` is `0`, not `NaN`. A bare `PORT=` in `.env` binds a random port; `WEB_PORT=`
yields a `localhost:0` CORS origin. Check for empty/blank before converting, and
range-check ports.

### 17. Imports buffer in memory, twice, with no size cap

`src/server/services/books.ts:277` holds the whole EPUB via `await file.arrayBuffer()`,
then `:293` reads it back in full to parse metadata, and `hashStoredFile` streams it a
third time. There is no max upload size on the route, so a large drop can OOM the server.

Stream to disk once, then hash and parse from the file.

Related: two concurrent imports of the same file can both pass the `fileHash` check at
`:280`; the loser hits the UNIQUE constraint and surfaces as a generic 500 rather than the
"duplicate" result.

---

## Performance

### 15. No pagination or virtualization

`GET /api/books` has no `LIMIT`, and `BookshelfGrid` renders every book. `loading="lazy"`
on covers helps, but a Calibre-scale library — which `docs/todo.md` lists as a goal — will
render thousands of DOM nodes and re-sort them client-side on every keystroke.

### 16. Reader prep extracts the full zip to disk

`src/server/services/epub.ts:451` writes *every* entry, including fonts and unused assets,
permanently doubling (uncompressed) storage per book. Serving assets on demand from the
zip, or extracting only spine-reachable files, would avoid it.

---

## Security

Calibrated for a local-first, loopback-bound, single-user app. The reader is already well
hardened: tag allowlist, `script`/`style`/`link` dropped, `javascript:` rejected, no
`dangerouslySetInnerHTML`, and `contextIsolation` + `sandbox` on every Electron window.

### 9. `shell.openExternal` had no scheme allowlist — fixed in `abc530b`

`setWindowOpenHandler` passed every URL straight to `shell.openExternal`, which dispatches
through the OS handler registry. A crafted book could hand the OS a `file:`, `smb:`, or
app-registered custom scheme URL.

Fixed by checking against the schemes the reader actually produces — `http`, `https`,
`mailto`, `tel`, matching `getReaderLinkTarget` — with the rules in
`electron/url-policy.cjs` so they are testable without booting Electron. `will-navigate`
is guarded the same way, and `openExternal`'s promise is no longer left unhandled.

Not covered by a test: that clicking a link in a real book still reaches the browser. The
policy decisions are unit tested and the app was confirmed to boot, but the end-to-end
click path needs a human.

### 18. SMTP password round-trips to the browser

`getSettingsPayload` (`src/server/services/settings.ts:109`) returns `smtp.pass` in
plaintext (`:82`), and the Settings form sends it back on save. Stored plaintext in the
`settings` table too.

For a loopback single-user app this is a defensible tradeoff, but the standard pattern is
cheap: return `hasPassword: boolean`, and treat an empty `pass` on save as "keep existing."
That also removes the credential from renderer memory and from anything that later logs a
settings response.

### 19. No CSP; dead Google Fonts preconnect

`index.html` has no CSP. Given the reader renders untrusted book content into the same
origin, `default-src 'self'` is meaningful defence in depth.

The `preconnect` hints at `index.html:7-8` are dead — fonts are self-hosted via
`@fontsource-variable` — so they are pure latency and an unnecessary third-party DNS lookup.

---

## Structure and maintainability

### 22. `App.tsx` is 6,648 lines

It holds 5 page components (`ReaderPage` alone is ~1,350 lines), ~30 inline SVG icon
components, 83 `useState`s, 53 `useEffect`s, and all the formatting and storage helpers.
Everything typechecks and the comments explaining the reader-pagination invariants are
genuinely good — but this file is the main tax on future work.

Natural seams: `icons.tsx`; `lib/storage.ts` for the localStorage getters/setters;
`lib/format.ts` for the `Intl` helpers; `hooks/` for `useTheme`, `useToast`,
`useMediaQuery`, `useFileDropTarget`, `useDocumentTitle`; then one file per page.

`src/web/styles.css` at 5,236 lines wants the same treatment.

### 23. `routeError` duplicated 3×; `GET /` handlers unguarded

Identical copies at `src/server/routes/books.ts:42`, `bookshelves.ts:23`, and
`settings.ts:29`, and every handler wraps itself in the same try/catch — except the three
`GET /` handlers (`books.ts:75`, `bookshelves.ts:47`, `settings.ts:53`), which have none
and so return Hono's default HTML 500 with no `error` field for the client to read.

Hono's `app.onError()` replaces all of it and fixes that inconsistency for free.

### 24. Two sources of schema truth

`drizzle.config.ts` points `out` at `./drizzle`, but no migrations directory exists. The
real schema is the raw DDL plus ad-hoc `hasColumn` ALTERs in `ensureSchema`
(`src/server/db/client.ts`). It works, but the Drizzle schema and the DDL can drift
silently — they already disagree cosmetically (`readStatus` ↔ `reading_status`).

Either commit to `drizzle-kit generate` migrations or drop `drizzle.config.ts` and document
the DDL as authoritative. Worth settling before the driver swap in finding 5.

### 25. Thin test coverage, no linter

`bun test` is wired up with two files: `src/server/db/persistence.test.ts` and
`src/server/services/books.delete.test.ts`. No ESLint or Biome config anywhere.

Highest-value untested targets, all pure and easy:

- `src/server/services/epub.ts` — metadata extraction, TOC label resolution, and
  `ensureSafeRelativePath` including the traversal cases
- `resolveEpubReaderAssetPath`
- `getReaderLinkTarget` in `src/web/lib/reader.tsx`

These are the parts most exposed to real-world EPUB variety and most likely to regress
silently.

### 26. `.trash` never swept; dead code

`deleteBook` `rm`s the trash directory on success, but a failed cleanup
(`src/server/services/books.ts:242`) just logs and leaves it. No startup sweep, so orphans
accumulate invisibly.

`addBookToResolvedBookshelf` (`src/server/services/bookshelves.ts:186`) is dead code.

`appConfig.webOrigins` is effectively vestigial in dev, since Vite proxies `/api`
same-origin — and it silently breaks if Vite falls back off `WEB_PORT`.

`docs/IMPLEMENTATION_PLAN.md` is stale relative to the code.

---

## Suggested order

1. **10, 11, 12, 13, 14** — small correctness fixes, all independent and cheap.
2. **23** — `app.onError()`. Deletes code and fixes the unguarded handlers.
3. **Spike the driver question** (see "Fix for 5, 6, and 7"). The answer decides whether
   **5** gets patched in place or waits for the swap.
4. **24 → 5/6/7** — settle the schema question, then swap the SQLite driver.
5. **22** — the `App.tsx` split, once nothing else is in flight over it.
