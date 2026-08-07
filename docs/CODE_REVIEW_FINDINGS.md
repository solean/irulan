# Code Review Findings

Findings from a full read of the codebase (server, web client, Electron shell, build
config) on 2026-07-31, plus the follow-up review of the fixes that landed the same day.

Line references were verified against `b9fb5f3`. They will drift — treat them as a
starting point, not gospel. `App.tsx` in particular moves constantly.

Nothing here is a blocker for a local single-user app that works today. The list is
roughly ordered by consequence within each section.

---

## Status summary

🟢 fixed  ·  🟡 open  ·  ⚪ no action needed

**26 of 27 resolved** — 25 fixed, 1 that turned out not to need fixing. 1 open.

| # | Finding | Status |
|---|---|---|
| 1 | Theme pre-paint script read the wrong storage key | 🟢 Fixed — `441d77c` |
| 2 | `deleteBook` rollback lost shelf memberships | 🟢 Fixed — `bea269b` |
| 3 | Database writes were non-atomic and unrecoverable | 🟢 Fixed — `0e0989d` |
| 4 | Save path did 4× redundant integrity checks; bad primary blocked all writes | 🟢 Fixed — `3b05559` |
| 5 | Failed save leaves memory ahead of disk | 🟢 Fixed — `88233a6`, guard later deleted |
| 6 | Saves block the event loop | 🟢 Fixed — better-sqlite3 swap |
| 7 | Transient memory ~2× database size per save | 🟢 Fixed — better-sqlite3 swap |
| 8 | `listBooks` is O(books × shelves) in queries | 🟢 Fixed — `ab2e4b1` |
| 9 | `shell.openExternal` has no scheme allowlist | 🟢 Fixed — `abc530b` |
| 10 | Unmatched `/api/*` returns HTML with status 200 | 🟢 Fixed — `da165f3` |
| 11 | `decodeURIComponent` throws outside try → 500 | 🟢 Fixed — `da165f3` |
| 12 | One bad zip entry makes a whole book unreadable | ⚪ **Not reachable** — see below (`d6d3e6f`) |
| 13 | LIKE wildcards unescaped in search | 🟢 Fixed — `c768acf` |
| 14 | `parseNumber` treats empty env var as 0 | 🟢 Fixed — `b9fb5f3` |
| 15 | No pagination or virtualization | 🟢 Fixed |
| 16 | Reader extracts the full zip to disk | 🟢 Fixed |
| 17 | Imports buffer in memory, no size cap | 🟢 Fixed |
| 18 | SMTP password round-trips to the browser | 🟢 Fixed |
| 19 | No CSP; dead Google Fonts preconnect | 🟢 Fixed |
| 20 | Database recovery is silent to the user | 🟢 Fixed |
| 21 | No cross-process locking | 🟢 Fixed — better-sqlite3 swap |
| 22 | `App.tsx` is 6,648 lines | 🟢 Fixed |
| 23 | `routeError` duplicated 3×; `GET /` handlers unguarded | 🟢 Fixed — `da165f3` |
| 24 | Two sources of schema truth | 🟢 Fixed |
| 25 | Thin test coverage, no linter | 🟡 Open |
| 26 | `.trash` never swept; dead code | 🟢 Fixed |
| 27 | Test suite ran against the real library | 🟢 Fixed |

---

## Database layer

The three commits on 2026-07-31 fixed the acute problems inside the sql.js model: writes
were atomic, a corrupt primary recovered from backup at startup, and the save path stopped
doing redundant work. Findings 6 and 7 were the residue of that model — the whole database
in memory, rewritten wholesale on every mutation — and they are gone because the model is
gone. The driver swap landed on 2026-08-07 and took findings 5, 6 and 7 with it.

### 🟢 Findings 5, 6 and 7 — resolved by the better-sqlite3 swap

`sql.js` is replaced by `better-sqlite3` 13. Writes go through SQLite itself, so a
mutation touches the pages it changes and nothing else. What that deleted:

- `src/server/db/persistence.ts` (314 lines), `persistDatabase`, and all 17 of its call
  sites. Nothing replaced them: a drizzle `.run()` is durable when it returns.
- The reload-on-failed-save guard from finding 5. A failed write now fails inside a real
  transaction, so memory cannot end up ahead of disk.
- The rollback tests that pinned that guard, and the whole-file persistence tests.

Measured on a 41.9 MB / 40k-row database, same shape both sides:

| | sql.js | better-sqlite3 |
|---|---|---|
| one rating write | 62 ms, event loop frozen throughout | 0.003 ms median, 0.026 ms p99 |
| a 1 ms timer during a save | fires once | unaffected |
| transient memory per save | +38 MB export, +41 MB check copy | none |
| cold open + `count(*)` | whole file read and validated | 0.5 ms |

End to end through the HTTP API on the packaged bundle: 400 bookshelf mutations measured
0.41 ms median / 1.84 ms max, and reads issued concurrently with those writes came back in
0.45 ms median / 1.6 ms max. Cover fetches no longer queue behind a rating click, which was
the point.

The driver is Node-API, which is what made this tractable: one prebuilt
`prebuilds/darwin-arm64.node` loads unchanged under Electron 41 (ABI 145) and Node 25/26
(ABI 141/147) with no rebuild step. The ABI objection recorded in the old version of this
section applied to better-sqlite3 11 and earlier, which shipped per-ABI `build/Release`
binaries; it is obsolete.

The cost was elsewhere, and it was the Bun runtime, which the old analysis missed: neither
better-sqlite3 nor `node:sqlite` loads under Bun 1.3.14, and Bun ran both `dev:server` and
the test suite. So the server moved to Node (`node --watch --import tsx`, since Node's
native type stripping does not resolve this repo's extensionless imports) and the tests
moved from `bun:test` to vitest, which keeps jest-style `expect` so no assertion changed.
Bun remains the package manager. Node 24 is now the floor — `engines` plus `.nvmrc` — because
the Node-API prebuild segfaults on the EOL Node 21 the repo had been using.

Durability and backup policy, both new:

- WAL with `synchronous = FULL`, so an acknowledged write survives a power cut. The `-wal`
  sidecar means `data/app.db` alone is no longer a complete library between checkpoints,
  so SIGINT/SIGTERM now closes the connection and folds the log back into the file.
- The `.bak` file is refreshed by SQLite's online backup (`Database.backup`, stepped with
  the event loop free between batches) once per startup, off the critical path, instead of
  riding along with every write. It is a guard against a damaged file, not a transaction
  log. A restore also deletes the replaced primary's `-wal`/`-shm`: SQLite pairs a WAL with
  its database by salt, and an orphaned one invites a replay against pages it never
  described.

### 🟢 5. A failed save left memory ahead of disk — fixed in `88233a6`, then deleted

Every mutation applied its change in memory and then called `persistDatabase()` at one of
15 unguarded call sites. A failed save returned 500 while the change stayed in memory, so
the API reported it as saved until the next restart dropped it. `persistDatabase` was made
to reopen the database from disk on a failed save, which cost a full reload on the failure
path and was explicitly a guard rather than a cure — the note said the driver swap would
make it unnecessary, and it did.

The one part worth keeping now that the code is gone: `db` is a live export binding, and
reassignment carries through the esbuild CJS bundle as well as under a plain loader
(verified both), so services that imported it pick up a replacement on their next query.
That is what makes hot-swapping the connection safe, and `initializeDatabase` still relies
on it.

### 🟢 6. Saves blocked the event loop — resolved by the swap

`persistDatabaseAtomically` was synchronous end to end: a 1 ms sampling timer set during a
save fired exactly once, because the whole server was frozen for the duration. Re-measured
at 62 ms median on a 41.9 MB database, spent as 28.6 ms full `integrity_check`, 17.9 ms
write and fsync, 6.1 ms backup rotation, 6.0 ms rename and directory fsync, 3.4 ms
`export()`. Every concurrent cover fetch and reader asset request queued behind a rating
click. See the swap section above for the numbers now.

### 🟢 7. Transient memory was ~2× the database size per save — resolved by the swap

On a 39.5 MB database `export()` added 38 MB and the integrity-check copy another 41 MB, so
RSS went 362 MB → 441 MB and back on every save. Both allocations were consequences of
serialising the whole database to write one row; neither exists now.

### 🟢 20. Recovery is silent to the user — fixed

`openDatabaseWithRecovery` returned a bare `recoveredFromBackup: true` that
`src/server/db/client.ts:85` turned into a `console.warn`. If the primary was corrupt at
startup you were rolled back to an older state, losing whatever the last save held, and
the UI said nothing.

The boolean was replaced with a `DatabaseRecovery` record (`src/shared/types.ts`) carrying
the backup file's mtime — how far back you were rolled to is the only part a user can act
on — and a `reason` distinguishing the two branches that used to look identical:

| branch | cause | surfaced as |
|---|---|---|
| `primary-corrupt` (`recovery.ts`) | the primary exists and fails `quick_check` | persistent banner |
| `primary-missing` (`recovery.ts`) | the primary is gone but the backup is not | `console.warn` only |

A missing primary costs about one save cycle and is the expected outcome of force-quitting
mid-write. Showing the same data-loss banner for both would make it routine, and a banner
people dismiss reflexively stops working for the case that matters. The policy is one
`Set` in `services/settings.ts` (`USER_VISIBLE_RECOVERY_REASONS`) if that judgement turns
out to be wrong.

Both branches go through `noteRecovery`. The original finding named `initializeDatabase` as
the only call site that dropped the flag; the second one lived in the `persistDatabase`
rollback guard, which the driver swap deleted, so `initializeDatabase` is once again the
only path that can produce a recovery record.

The notice is stored in the `settings` table rather than a client-side dismissal flag, and
is acknowledged by `recoveredAt` rather than a boolean. A plain "dismissed" flag would
swallow the *next* recovery — the same silent-data-loss bug this finding is about,
reintroduced by its own fix. `settings.recovery.test.ts` pins that.

`GET /api/settings` carries it, so nothing new is fetched on boot; the banner is mounted in
`Shell` rather than on `BookshelfPage`, because someone who deep-links to a book has to see
it too.

### 🟢 21. No cross-process locking — resolved by the swap

Running the dev server and the packaged Electron app against the same data directory used
to mean two processes doing whole-file writes with no coordination: last writer won and
silently discarded the other's work, and a race could leave a torn primary, which is the
spurious-recovery case finding 20 surfaces.

SQLite takes POSIX locks on the database and its WAL, so this is now handled by the file
format rather than by hope. Two processes interleave writes correctly; a writer that cannot
get the lock waits out the connection's `busy_timeout`, which better-sqlite3 defaults to
5000 ms (verified against the open connection), and only then raises `SQLITE_BUSY`. Nothing
is silently lost either way.

### Known and deliberate

- The startup check is `quick_check`, not `integrity_check`. On a 41.9 MB library the full
  check takes 2.1 s against 20 ms for the quick one, and the damage that matters at
  startup — a truncated, clobbered or non-SQLite file, or a scrambled page — fails the
  quick check too, which `recovery.test.ts` pins with a deliberately damaged page.
- `openDatabaseWithRecovery` still carries two recovery branches that differ only in the
  reason they report. They stay separate because the reason drives whether the user sees a
  banner.
- The backup is refreshed once per startup, so a long-running instance carries an ageing
  `.bak`. That is the intended trade: SQLite's own crash safety covers process death, and
  the backup exists for a damaged file, which no write-time rotation would predict either.

---

## Correctness

### 🟢 8. `listBooks` was O(books × shelves) in queries — fixed in `ab2e4b1`

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

### 🟢 10. Unmatched `/api/*` returned HTML with status 200 — fixed in `da165f3`

The SPA catch-all sat behind no API 404 guard, so a missing endpoint returned index.html
with a 200. `response.ok` was true, `response.json()` threw, and the fallback `{error: …}`
was returned *as* `T`, leaving callers to render undefined fields.

Fixed with `app.all("/api/*", …)` returning a JSON 404, registered after the routers and
before the catch-all. Non-API routes still reach the SPA.

### 🟢 11. `decodeURIComponent` threw outside the try — fixed in `da165f3`

A request for `/assets/%` produced an uncaught `URIError` and a 500. `resolvePublicPath`
now returns null for a malformed escape, which the handler already treats as a miss.

Worth knowing for future path tests: URL parsing collapses a literal `../` before the app
sees it, so traversal has to be percent-encoded to reach the guard at all.

### ⚪ 12. One bad zip entry makes a whole book unreadable — premise was wrong

**This finding was not reachable as written.** JSZip 3.10.1 runs every entry name through
`utils.resolve()` when loading an archive (`load.js:66`), which collapses `..` and cannot
climb past the root; the original name survives only as `unsafeOriginalName`, which this
code never reads. So `entry.name` can never carry a traversal, and the throw in the
extraction loop could not fire. No EPUB was ever made unreadable this way.

Changed anyway in `d6d3e6f`: the loop skips an unsafe entry rather than throwing, so the
guarantee no longer rests on a dependency's sanitizing behaviour — the kind of thing that
is silently load-bearing until it changes. Only the *path* is treated that way; a write
that fails for any other reason (a full disk above all) still surfaces, rather than caching
a half-extracted book behind a manifest that claims it is complete.

**Superseded by finding 16.** There is no extraction loop any more, so a traversing entry
name is not a write hazard of any kind — it is simply unreachable, since the entry index
and the request path normalize the same way and no request survives the guard with a
leading `"../"`. What changed in exchange: yauzl refuses to enumerate an archive carrying a
`..` segment at all (`validateFileName`), so such a file is now rejected whole rather than
per entry. That is not a regression in reach — import has parsed metadata through yauzl
since finding 17, so no such book could enter the library — and it is now uniform: import
and read fail the same file the same way. `epub.test.ts` pins both halves.

**What the tests did find**, in the same guard, on the path that genuinely faces untrusted
input — the asset path comes straight from the request URL:

- `".."` has no trailing slash, so it slipped past a `startsWith("../")` check and resolved
  to the directory above the extracted content.
- `""` normalizes to `"."`, so the emptiness check never fired and it resolved to the
  content directory itself.

Neither could reach a file outside the reader directory — any deeper traversal *does*
normalize to a leading `"../"` and was caught — so the effect was a 500 where a 400
belonged. Both are rejected now, by `ensureSafeRelativePath` on the way into
`readEpubReaderAsset`.

Worth carrying forward: a check for path traversal that runs *after* normalization has to
handle the bare `".."` and `"."` forms explicitly, not just prefixed ones.

### 🟢 13. LIKE wildcards unescaped in search — fixed in `c768acf`

Values were parameterized so there was no injection, but `%` and `_` stayed live
metacharacters: `100%` built the pattern `%100%%` and matched every book, and `a_b` also
matched `axb`. The pattern now escapes `%`, `_` and the escape character, and the query
names the escape character explicitly.

### 🟢 14. `parseNumber` treated an empty env var as 0 — fixed in `b9fb5f3`

`Number("")` is `0`, not `NaN`, so a bare `PORT=` bound a random port and `WEB_PORT=` gave a
`localhost:0` CORS origin. Blank now means "not set". Ports are range-checked too, which the
duplicated inline parsing for `PORT` never did; port 0 stays legal because the Electron
shell sets it deliberately to get a free port. (Finding 26 later removed CORS entirely, so
the server no longer reads `WEB_PORT` at all; Vite validates it.)

### 🟢 17. Imports buffered in memory with no size cap — fixed

The import route now parses multipart uploads as streams, enforces a 200 MB per-file cap,
a 1 GB request cap, and a 20-file limit, and hashes each EPUB while writing it to its final
storage path. Metadata parsing uses file-backed ZIP access and reads only bounded container,
package, and cover entries instead of loading the complete archive into memory.

The hash lookup remains as a fast duplicate check, but the unique `file_hash` constraint is
now the final arbiter. A concurrent losing insert resolves the winning row, applies the
requested bookshelf assignments, removes its staged directory, and returns the normal
`duplicate` result.

---

## Performance

### 🟢 15. No pagination or virtualization — fixed

`GET /api/books` now validates a bounded page request (60 books by default, 100 maximum)
and applies shelf, search, status, and stable sorting in SQLite before `LIMIT`/`OFFSET`.
The response includes global totals and status counts, while the web client keeps only the
current page and renders accessible Previous/Next controls for both grid and list views.

### 🟢 16. Reader prep extracted the full zip to disk — fixed

`prepareEpubReader` wrote *every* archive entry under `<book>/reader/content/` — fonts,
unused images, the lot — permanently doubling a book's uncompressed footprint. Measured on
a 19 MB EPUB in the developer's library: 40 MB on disk, 21 MB of it extracted content.

Nothing is unpacked now. Reader prep writes only `manifest.json`, and
`readEpubReaderAsset` opens the EPUB, seeks to the requested entry and streams it back.
The same 19 MB book now occupies 19 MB, and all 53 sections plus every image still serve
200s straight from the archive.

The zip is opened per asset request rather than kept warm behind a handle cache. Reading a
central directory is one seek and a small buffered read, so the cost is far below the HTTP
round trip it rides on — 50 fetches of a 76 KB section took 1.19 s wall *including* 50
`curl` process spawns. A handle cache would need an eviction policy and a file-descriptor
budget to buy back time nobody can perceive.

Three things worth carrying forward:

- **The reader path moved to yauzl**, which the import path already used since finding 17,
  so `parseEpub` and the container/package preamble of `extractEpubMetadata` collapsed into
  one `openEpub`. JSZip is no longer a runtime dependency at all — only test fixtures build
  archives with it, so it moved to `devDependencies`. This also ends the reader's whole-file
  `readFile` of the EPUB.
- **Directory entries are dropped from the entry index.** They carry a trailing slash and no
  content, so without that filter a request for `OEBPS/` would have resolved to a zero-byte
  200.
- **Existing libraries need the space back.** A lazy sweep on next open would leave a book
  nobody re-reads holding its stale copy forever, so `sweepExtractedReaderContent`
  (`src/server/lib/storage.ts`) runs from `startServer` beside `sweepTrash`, before the
  server accepts requests. It removes only `reader/content/`, never the manifest or the
  EPUB, logs per-book failures without blocking boot, and is a no-op on the next start.

---

## Security

Calibrated for a local-first, loopback-bound, single-user app. The reader is already well
hardened: tag allowlist, `script`/`style`/`link` dropped, `javascript:` rejected, no
`dangerouslySetInnerHTML`, and `contextIsolation` + `sandbox` on every Electron window.

### 🟢 9. `shell.openExternal` had no scheme allowlist — fixed in `abc530b`

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

### 🟢 18. SMTP password round-tripped to the browser — fixed

The settings response no longer includes the SMTP password. It exposes only
`hasPassword` and `passwordSource`, and the renderer keeps the password input empty. Blank
password updates preserve the current credential; replacement and clearing are explicit.

App-saved passwords are encrypted through Electron's OS-backed `safeStorage` integration
and legacy plaintext `smtp_pass` rows migrate before the server accepts requests.
Standalone Node/Bun continues to use `SMTP_PASS`, including when an inaccessible encrypted
app credential exists; an environment password also lets startup remove a legacy plaintext
row safely. SMTP fields and credential changes persist atomically.

Regression tests cover response redaction, save/preserve/replace/clear, both legacy
migration paths, environment fallback, recovery from an unreadable credential, refusal to
persist plaintext, and rollback after a failed save.

### 🟢 19. No CSP; dead Google Fonts preconnect — fixed

The app now sends a restrictive Content-Security-Policy header for the SPA shell
in production, with the Vite development policy relaxing inline-script and
WebSocket restrictions needed by React Refresh/HMR during local development.
Production allows the inline theme bootstrap through an automatically generated
SHA-256 hash rather than `unsafe-inline` script execution. The policy keeps
scripts, fonts, connections, and book assets same-origin, permits the reader's
data-backed inline SVG images, and disables plugins, base-URI changes, and
framing.

The unused Google Fonts preconnect hints were removed from `index.html`; fonts
are self-hosted through `@fontsource-variable`.

---

## Structure and maintainability

### 🟢 22. `App.tsx` was 6,648 lines — fixed

`src/web/App.tsx` is now a 32-line provider and route composition module. The five route
components live under `src/web/pages/`; application shell, bookshelf, book, modal, menu,
skeleton, onboarding, icon, and reader-appearance components live under
`src/web/components/`. Theme, toast, media-query, debounce, file-drop, and document-title
behavior moved to focused hooks, while storage, formatting, navigation, import, status,
and reader helpers live under `src/web/lib/`.

`ReaderPage.tsx` remains intentionally cohesive around pagination: section loading, DOM
measurement, frozen offsets, gestures, keyboard navigation, progress persistence, and the
comments documenting their invariants stay together. Its reusable appearance controls and
pure markup helpers were extracted.

`src/web/styles.css` is now a 23-line ordered import manifest. The original rules are split
across ownership-based files under `src/web/styles/`, with cascade order and the final
responsive override layer preserved.

The refactor passed TypeScript checking, the production build, all 91 tests, and browser
smoke checks covering the bookshelf, book detail, reader, settings, and bookshelves routes.

### 🟢 23. `routeError` duplicated 3×; `GET /` handlers unguarded — fixed in `da165f3`

`app.onError` now shapes every error once, for the app and every router mounted on it
(verified: errors from mounted sub-routers do reach the root handler).

The ranking here was initially backwards. The duplication was cosmetic; the real defect was
the three `GET /` handlers with no try/catch, which let a deliberate error escape as Hono's
default plain-text 500:

```
before  GET /api/books?bookshelfId=deleted-shelf -> 500 text/plain "Internal Server Error"
after   GET /api/books?bookshelfId=deleted-shelf -> 404 {"error":"Bookshelf not found."}
```

That path is reachable from an ordinary bookmark, since the selected shelf lives in the URL.
Handlers now throw and return directly, taking 105 lines out of the routing layer.

### 🟢 24. Two sources of schema truth — fixed

`src/server/db/schema.ts` now defines the current schema, and committed Drizzle migrations
under `drizzle/` are the only path that changes an existing database. Startup runs the
better-sqlite3 migrator inside SQLite's own transaction; the Electron package explicitly
includes the migration directory. The baseline is idempotent so databases created by the old
raw-DDL bootstrap adopt the migration journal without losing their data, and a narrow
compatibility step adds the three columns that historical releases could be missing.

The cited `readStatus` ↔ `reading_status` difference was normal Drizzle property-to-column
mapping, not drift. The review did expose two real omissions in `schema.ts`: the
`deliveries` foreign keys and its bookshelf/date index. Both are now represented in the
schema and baseline. Migration tests cover a fresh database, repeat startup, and adoption
of the pre-migration schema.

### 🟡 25. Thin test coverage, no linter

`vitest run` now covers the database recovery and backup paths, migrations, `deleteBook`,
`listBooks`, reader manifest building and zip-backed asset reads, both storage sweeps, and
the API surface in `src/server/app.test.ts`. Still no ESLint or Biome config anywhere.

Highest-value untested targets, all pure and easy:

- `src/server/services/epub.ts` — metadata extraction and TOC label resolution.
  `ensureSafeRelativePath` is covered through `readEpubReaderAsset`, including the
  traversal cases
- `getReaderLinkTarget` in `src/web/lib/reader.tsx`

These are the parts most exposed to real-world EPUB variety and most likely to regress
silently.

### 🟢 26. `.trash` never swept; dead code

`deleteBook` still moves a book's files to `.trash` before deleting its rows and removes them
afterwards, but a stranded directory is no longer permanent: `sweepTrash`
(`src/server/lib/storage.ts`) empties the trash directory and runs from `startServer` before
the server accepts requests, which is the one moment no delete can be mid-flight waiting to
restore its files. Failures are logged per entry and never block boot, and a non-empty sweep
logs what it removed. The trash path also moved out of `deleteBook` into `trashDirectory()`
beside the other storage paths. Covered by `src/server/lib/storage.test.ts`.

`addBookToResolvedBookshelf` is gone.

`appConfig.webOrigins` and the CORS middleware are gone, along with the now-unused
`appConfig.webPort`. Every client is same-origin — Vite proxies `/api` in dev, and the server
serves the built client in production and under Electron — so the allowance only ever
described an origin nothing used, guessed at a port Vite may not have. `WEB_PORT` remains a
Vite-only setting.

`docs/IMPLEMENTATION_PLAN.md` is now labelled historical, with the two sections that kept
rotting against the code (the column-by-column data model and the endpoint list) replaced by
pointers to `src/server/db/schema.ts` and `src/server/routes/`.

### 🟢 27. The test suite ran against the developer's real library

Found the hard way on 2026-08-05: a full `bun test` run deleted every `books` and
`bookshelves` row in the live library and replaced the shelves with its own fixtures.

`appConfig` snapshots the environment once, at first import, and every file in a `bun test`
run shares one module registry — so whichever file imported the config first decided where
all of them read and wrote. Each test file set `EBOOK_DATA_DIR`/`EBOOK_STORAGE_DIR` before a
dynamic import and assumed it had won that race. `src/server/config.test.ts` imported the
config statically with no overrides at all, and Bun loads `.env` for test runs, so when that
import landed first every other file inherited the developer's real `EBOOK_*` paths.
`books.delete.test.ts` and `app.test.ts` truncate tables in `beforeEach` and call
`persistDatabase()`, which wrote the emptied catalog straight to the real `app.db` — and
because each save rotates the previous file to `app.db.bak`, the backup was overwritten too.

The EPUBs themselves were never at risk; only the catalog was lost. It was rebuilt from the
files on disk, keeping each book's directory id so extracted reader content and covers stayed
addressable. Per-book read status and ratings were not recovered.

**"Not recoverable" was wrong about the rest.** The wipe was a row delete, not a rewrite, so
the deleted cells survived as freeblock slack in `app.db` — and identically in `app.db.bak`,
since the rotation copied the same pages. Carving page 11 (the `bookshelves` page) and pages
5/13/14 recovered, byte-for-byte:

- the second bookshelf (`b792ce35-…`), its Kindle address, and its `sort_order`
- both of its `book_shelves` memberships
- both of its `deliveries` rows in full — ids, SMTP message ids, `created_at` and `sent_at`

All of it was restored on 2026-08-05; `pragma integrity_check` and `foreign_key_check` are
clean and the shelf renders normally. Only two values could not be read, because later
writes landed on top of them: the shelf's `created_at`, and the `added_at` of one
membership. Both were set to timestamps bounded by surviving evidence and are accurate to
within seconds.

The lesson for the next incident: a freshly wiped SQLite file is not empty. Copy it before
the app can rotate or vacuum it, then carve, before concluding anything is gone.

`src/test/setup.ts`, run as a vitest `setupFiles` entry, now settles the race instead of
racing: it points `EBOOK_DATA_DIR`, `EBOOK_STORAGE_DIR`, and `IRULAN_PUBLIC_DIR` at a temp
directory, imports the config itself so the safe paths are cached before the test file's own
imports evaluate, and then asserts every resolved path sits inside that temp root — a suite
pointed at a real library refuses to run rather than writing to it. Test files no longer set
those variables or dynamically import to dodge hoisting; they read `appConfig` and get a temp
directory. Since the move off `bun test`, each file gets its own setup run and its own temp
root, so the shared-module-registry hazard behind this incident no longer exists at all.

---

## Suggested order

1. **25** — a linter, and the two remaining pure targets above.

Ordering note: prefer consequence over cheapness. An earlier revision of this list put the
cheap correctness batch ahead of finding 5 on the grounds that the driver swap would soon
delete any fix for it, then reversed that when the swap looked far off. The swap landed on
2026-08-07 and did delete it, which is worth remembering the next time a fix is justified by
a rewrite that has not happened: the guard was cheap and bought six days of correctness, so
the reversal was still right.
