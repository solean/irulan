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

**22 of 27 resolved** — 21 fixed, 1 that turned out not to need fixing. 5 open.

| # | Finding | Status |
|---|---|---|
| 1 | Theme pre-paint script read the wrong storage key | 🟢 Fixed — `441d77c` |
| 2 | `deleteBook` rollback lost shelf memberships | 🟢 Fixed — `bea269b` |
| 3 | Database writes were non-atomic and unrecoverable | 🟢 Fixed — `0e0989d` |
| 4 | Save path did 4× redundant integrity checks; bad primary blocked all writes | 🟢 Fixed — `3b05559` |
| 5 | Failed save leaves memory ahead of disk | 🟢 Fixed — `88233a6` |
| 6 | Saves block the event loop | 🟡 Open (architectural) |
| 7 | Transient memory ~2× database size per save | 🟡 Open (architectural) |
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
| 21 | No cross-process locking | 🟡 Open |
| 22 | `App.tsx` is 6,648 lines | 🟢 Fixed |
| 23 | `routeError` duplicated 3×; `GET /` handlers unguarded | 🟢 Fixed — `da165f3` |
| 24 | Two sources of schema truth | 🟡 Open |
| 25 | Thin test coverage, no linter | 🟡 Open |
| 26 | `.trash` never swept; dead code | 🟢 Fixed |
| 27 | Test suite ran against the real library | 🟢 Fixed |

---

## Database layer

The three commits on 2026-07-31 fixed the acute problems: writes are atomic, a corrupt
primary recovers from backup at startup, and the save path no longer does redundant
work. What remains below is a property of keeping the whole database in memory and
rewriting it wholesale — it cannot be repaired inside `persistence.ts`.

### 🟢 5. A failed save left memory ahead of disk — fixed in `88233a6`

Every mutation applied its change in memory and then called `persistDatabase()` at one of
15 unguarded call sites. A failed save returned 500 while the change stayed in memory, so
the API reported it as saved until the next restart dropped it.

`persistDatabase` now reopens the database from disk when a save fails, so memory matches
what is stored before the error propagates. Observed through the API with the data
directory made read-only, patching a rating from 2 to 5:

| | PATCH result | rating read back | rating on disk |
|---|---|---|---|
| before | 500 | 5 | 2 |
| after | 500 | 2 | 2 |

The mechanism worth remembering: `db` is a live export binding, and reassignment carries
through both Bun and the esbuild CJS bundle (verified both), so services that imported it
pick up the replacement on their next query. The old handle is closed only once the
replacement is open. A test calls through a service that resolved `db` before the swap,
since that is where a stale handle would surface.

This is a guard, not a cure — it costs a full reload on the failure path, and the swap in
findings 6 and 7 would make it unnecessary. It earns its place because that swap is not
near-term.

### 🟡 6. Saves block the event loop

`persistDatabaseAtomically` is synchronous end to end. A 1 ms sampling timer set during a
save never fires once — the whole server is frozen for the duration. Measured median
45 ms on a 39.5 MB database, so every concurrent cover fetch and reader asset request
queues behind a rating click.

### 🟡 7. Transient memory is ~2× the database size per save

Measured on a 39.5 MB database: `export()` adds 38 MB, the integrity-check copy adds
another 41 MB. RSS goes 362 MB → 441 MB and back on every save.

### Fix for 6 and 7

Both dissolve with a real SQLite driver, which writes only changed pages, gives real
transactions where a failed write fails atomically, and lets `src/server/db/persistence.ts`
and the rollback guard from finding 5 be deleted entirely.

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

Because that spike has not happened, finding 5 was fixed in place rather than waiting for
the swap to delete it.

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
| `primary-corrupt` (`persistence.ts:183`) | the primary exists and will not open | persistent banner |
| `primary-missing` (`persistence.ts:205`) | crash between `rotateBackup` and the rename | `console.warn` only |

A missing primary costs about one save cycle and is the expected outcome of force-quitting
mid-write. Showing the same data-loss banner for both would make it routine, and a banner
people dismiss reflexively stops working for the case that matters. The policy is one
`Set` in `services/settings.ts` (`USER_VISIBLE_RECOVERY_REASONS`) if that judgement turns
out to be wrong.

Two call sites dropped the flag, not one. The original finding named
`initializeDatabase`; `reloadFromDisk` also discarded its return value inside the
`persistDatabase` rollback guard, where the on-disk library falls back to the backup while
the caller only ever learns that a save failed. Both now go through `noteRecovery`.

The notice is stored in the `settings` table rather than a client-side dismissal flag, and
is acknowledged by `recoveredAt` rather than a boolean. A plain "dismissed" flag would
swallow the *next* recovery — the same silent-data-loss bug this finding is about,
reintroduced by its own fix. `settings.recovery.test.ts` pins that.

`GET /api/settings` carries it, so nothing new is fetched on boot; the banner is mounted in
`Shell` rather than on `BookshelfPage`, because someone who deep-links to a book has to see
it too.

### 🟡 21. No cross-process locking

Running `bun run dev` and the packaged Electron app against the same data directory means
two processes doing whole-file writes with no coordination. Last writer wins and silently
discards the other's work.

This also makes spurious recoveries more likely: two processes racing on the same
whole-file write can leave a torn primary, which is what finding 20 now surfaces.

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

### 🟡 24. Two sources of schema truth

`drizzle.config.ts` points `out` at `./drizzle`, but no migrations directory exists. The
real schema is the raw DDL plus ad-hoc `hasColumn` ALTERs in `ensureSchema`
(`src/server/db/client.ts`). It works, but the Drizzle schema and the DDL can drift
silently — they already disagree cosmetically (`readStatus` ↔ `reading_status`).

Either commit to `drizzle-kit generate` migrations or drop `drizzle.config.ts` and document
the DDL as authoritative. Worth settling before the driver swap in finding 5.

### 🟡 25. Thin test coverage, no linter

`bun test` now covers the database persistence and rollback paths, `deleteBook`, `listBooks`,
reader manifest building and zip-backed asset reads, both storage sweeps, and the API
surface in `src/server/app.test.ts`. Still no ESLint or Biome config anywhere.

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

`src/test/setup.ts`, preloaded via `bunfig.toml`, now settles the race instead of racing:
it points `EBOOK_DATA_DIR`, `EBOOK_STORAGE_DIR`, and `IRULAN_PUBLIC_DIR` at a per-run temp
directory, imports the config itself so the safe paths are cached before any test file loads,
and then asserts every resolved path sits inside that temp root — a suite pointed at a real
library refuses to run rather than writing to it. Test files no longer set those variables or
dynamically import to dodge hoisting; they read `appConfig` and get a temp directory.

---

## Suggested order

1. **24 → 6/7** — settle the schema question, then spike and swap the SQLite driver.
2. **21** — cross-process locking, if the dev server and the packaged app ever run together.
3. **25** — a linter, and the two remaining pure targets above.

Ordering note: prefer consequence over cheapness. An earlier revision of this list put the
cheap correctness batch ahead of finding 5 on the grounds that the driver swap would soon
delete any fix for it. When the swap turned out not to be near-term that reasoning expired,
but the order was not revisited.
