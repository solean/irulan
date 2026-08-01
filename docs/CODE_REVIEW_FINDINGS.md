# Code Review Findings

Findings from a full read of the codebase (server, web client, Electron shell, build
config) on 2026-07-31, plus the follow-up review of the fixes that landed the same day.

Line references were verified against `da165f3`. They will drift — treat them as a
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
| 5 | Failed save leaves memory ahead of disk | Fixed — `88233a6` |
| 6 | Saves block the event loop | Open (architectural) |
| 7 | Transient memory ~2× database size per save | Open (architectural) |
| 8 | `listBooks` is O(books × shelves) in queries | Fixed — `ab2e4b1` |
| 9 | `shell.openExternal` has no scheme allowlist | Fixed — `abc530b` |
| 10 | Unmatched `/api/*` returns HTML with status 200 | Fixed — `da165f3` |
| 11 | `decodeURIComponent` throws outside try → 500 | Fixed — `da165f3` |
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
| 23 | `routeError` duplicated 3×; `GET /` handlers unguarded | Fixed — `da165f3` |
| 24 | Two sources of schema truth | Open |
| 25 | Thin test coverage, no linter | Open |
| 26 | `.trash` never swept; dead code | Open |

---

## Database layer

The three commits on 2026-07-31 fixed the acute problems: writes are atomic, a corrupt
primary recovers from backup at startup, and the save path no longer does redundant
work. What remains below is a property of keeping the whole database in memory and
rewriting it wholesale — it cannot be repaired inside `persistence.ts`.

### 5. A failed save left memory ahead of disk — fixed in `88233a6`

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

### 6. Saves block the event loop

`persistDatabaseAtomically` is synchronous end to end. A 1 ms sampling timer set during a
save never fires once — the whole server is frozen for the duration. Measured median
45 ms on a 39.5 MB database, so every concurrent cover fetch and reader asset request
queues behind a rating click.

### 7. Transient memory is ~2× the database size per save

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

### 10. Unmatched `/api/*` returned HTML with status 200 — fixed in `da165f3`

The SPA catch-all sat behind no API 404 guard, so a missing endpoint returned index.html
with a 200. `response.ok` was true, `response.json()` threw, and the fallback `{error: …}`
was returned *as* `T`, leaving callers to render undefined fields.

Fixed with `app.all("/api/*", …)` returning a JSON 404, registered after the routers and
before the catch-all. Non-API routes still reach the SPA.

### 11. `decodeURIComponent` threw outside the try — fixed in `da165f3`

A request for `/assets/%` produced an uncaught `URIError` and a 500. `resolvePublicPath`
now returns null for a malformed escape, which the handler already treats as a miss.

Worth knowing for future path tests: URL parsing collapses a literal `../` before the app
sees it, so traversal has to be percent-encoded to reach the guard at all.

### 12. One bad zip entry makes a whole book unreadable

`src/server/services/epub.ts:454`: `ensureSafeRelativePath(entry.name)` *throws* inside the
extraction loop, aborting `prepareEpubReader` after `:448` has already `rm`'d the reader
directory. A single odd entry name (absolute path, stray `..`) means the EPUB never opens,
with a 400 that reads like the file is corrupt.

The traversal guard itself is correct — the failure mode is wrong. Skip the entry instead
of throwing.

### 13. LIKE wildcards unescaped in search

`src/server/services/books.ts:96`. Values are parameterized so there is no injection, but
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

### 23. `routeError` duplicated 3×; `GET /` handlers unguarded — fixed in `da165f3`

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

`addBookToResolvedBookshelf` (`src/server/services/bookshelves.ts:254`) is dead code.

`appConfig.webOrigins` is effectively vestigial in dev, since Vite proxies `/api`
same-origin — and it silently breaks if Vite falls back off `WEB_PORT`.

`docs/IMPLEMENTATION_PLAN.md` is stale relative to the code.

---

## Suggested order

1. **12, 13, 14** — small correctness fixes, all independent and cheap. **12** first: a
   book that will not open is the most visible of the three.
2. **20** — surface database recovery to the user. Needs a UX decision first.
3. **24 → 6/7** — settle the schema question, then spike and swap the SQLite driver.
4. **22** — the `App.tsx` split, once nothing else is in flight over it.

Ordering note: prefer consequence over cheapness. An earlier revision of this list put the
cheap correctness batch ahead of finding 5 on the grounds that the driver swap would soon
delete any fix for it. When the swap turned out not to be near-term that reasoning expired,
but the order was not revisited.
