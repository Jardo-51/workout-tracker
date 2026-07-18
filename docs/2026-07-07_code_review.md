# Code Review — 2026-07-07

Full-project review: all of `src/`, build/PWA config, CI workflows, and server config
(`public/.htaccess`). `pnpm lint` and `pnpm type-check` both pass clean; everything below
is from manual review.

Each finding has a number for referencing and a checkbox to tick once addressed.

**Severity legend**

| Severity | Meaning |
|---|---|
| CRITICAL | Will cause bugs, data loss, or security issues if shipped as-is |
| HIGH | Significant design flaw or performance problem; fix before shipping |
| MEDIUM | Best-practice violation or maintenance burden; fix recommended |
| LOW | Style, minor improvement, nitpick |

**Counts:** 1 CRITICAL · 3 HIGH · 9 MEDIUM · 17 LOW

---

## CRITICAL

- [x] **1. StepperField can save a value different from what is displayed** — `src/components/session/StepperField.vue:62-70`
  `onInput` only commits to the model when the parsed value is valid and `>= min`; otherwise the
  text keeps showing whatever the user typed while the model silently keeps the *old* number.
  Examples: for Reps (`min: 1`), clearing the field or typing `0` shows `0`/empty, but Save stores
  the previous value (e.g. 8). Same for non-numeric input in the Weight field. Since the Save
  button validates against the (stale but valid) model, the user records workout data that does
  not match what was on screen. Fix: track validity, disable Save on invalid text, and/or
  normalize the text back to the model on blur.

## HIGH

- [x] **2. No multi-tab/multi-window coordination — concurrent tabs overwrite each other's data** — `src/stores/sessions.ts:17-23`, `src/stores/sync.ts`
  Each tab loads all sessions into memory once (`load()`) and writes whole sessions back on every
  mutation. Two open tabs (a normal situation for a web-installed PWA on desktop) never see each
  other's changes: the tab with the stale in-memory copy overwrites the other tab's newer entries
  in IndexedDB on its next `persist()`. Both tabs also run independent sync loops against the same
  `syncMeta` store, which can race `getSyncMeta` → "no meta" → both `create` an item, producing
  duplicate server items for one session. Consider a `BroadcastChannel` (or `storage` events) to
  propagate mutations, plus a Web Locks API guard around `syncSessions`.

- [x] **3. One malformed remote item permanently wedges sync** — `src/services/etesync.ts:82-108`
  In the pull loop, `JSON.parse(await item.getContent(...))` runs before the new `stoken` is
  persisted (`setMeta` happens only after the whole loop). If any item ever contains content that
  isn't valid JSON — or valid JSON that isn't a `Session` (schema drift from a future app version,
  a different client writing to the collection) — every sync re-pulls the same page, throws, and
  aborts. Sync is then dead until logout/login, and even that won't help because the item is still
  there. Wrap per-item processing in a try/catch (skip + surface a warning), and validate the
  parsed object minimally (has `id`, `updatedAt`, `entries`) before applying.

- [x] **4. Conflict resolution trusts the client wall clock** — `src/stores/sessions.ts:84-88`, `src/services/etesync.ts:90`
  Last-write-wins compares `session.updatedAt` values produced by `Date.now()` on different
  devices. A device with a skewed clock (manually set, drifted, wrong timezone fix-ups) silently
  loses genuinely newer edits, and because LWW is per whole session, a lost write discards *all*
  entries added on the losing device, not just a field. Documented in the README, but still the
  riskiest property of the design. Mitigations to consider: per-entry merging (union of entries by
  `id`, tombstones per entry), or at least a monotonic counter (`updatedAt = max(Date.now(),
  updatedAt + 1)`) so a backwards-jumping clock can't lose edits made on the same device.
  — _Took the monotonic counter (`nextUpdatedAt` in the sessions store), not per-entry merging.
  Because a pulled session carries the writing device's stamp, deriving the next stamp from it
  also fixes the cross-device case the finding describes: an edit made on a slow-clocked device
  now supersedes one from a device running ahead, rather than being silently dropped. The
  per-whole-session granularity stands — two devices editing the same session between syncs still
  costs the loser its entries. Per-entry merging with tombstones is a substantial redesign; it is
  now the documented residual risk (README) rather than an undocumented one._

## MEDIUM

- [x] **5. Etebase account session stored unencrypted in localStorage** — `src/stores/sync.ts:28,61`
  `account.save()` output contains the account's symmetric key material; anything running in the
  page origin can lift it and decrypt the user's server-side data. The strict CSP in `.htaccess`
  lowers XSS risk considerably, but `Etebase.Account.save(encryptionKey)` supports wrapping the
  session with a key — consider storing the saved session in IndexedDB and/or documenting the
  trade-off. At minimum, be aware that "end-to-end encrypted" holds only as long as the device/
  browser profile is trusted.
  — _Documented, in the README and at `LS_SESSION`; deliberately **not** "fixed", because both
  suggested mitigations are theatre against the threat named. The threat is code running in this
  origin. IndexedDB is the same origin. `Account.save(encryptionKey)` needs a key the app can
  read unattended on every start, so it must live in the same origin too — an attacker who can
  read localStorage can read the key and call decrypt. A non-extractable WebCrypto key raises the
  bar only against a passive dump, not against anyone who runs code in the page, and costs a
  migration to buy that. The one mitigation with teeth is deriving the key from a passphrase
  typed at every app start, which trades away the open-and-log UX the app exists for — a product
  call, not a code-review call. So the honest resolution is the finding's own "at minimum": say
  plainly that being logged in means trusting the device, and that the encryption covers transit
  and the server rather than the device._

- [x] **6. CSP may block libsodium's WebAssembly** — `public/.htaccess:13`
  `etebase` depends on libsodium, which compiles a wasm module at startup. Chromium requires
  `'wasm-unsafe-eval'` in `script-src` for `WebAssembly.instantiate`; with plain
  `script-src 'self'` libsodium either falls back to the much slower asm.js build or fails
  outright depending on version. Verify login/sync against the production server with this exact
  header; likely fix is `script-src 'self' 'wasm-unsafe-eval'`.
  — _Confirmed the premise before fixing: etebase bundles libsodium-wrappers, and its dist calls
  `WebAssembly.instantiate`/`instantiateStreaming`. Added `'wasm-unsafe-eval'` to `script-src`.
  Not verified against the production server — the header only takes effect once deployed, so
  that check is still worth doing on the next deploy._

- [x] **7. First-login race can create two collections (split-brain sync)** — `src/services/etesync.ts:39-58`
  `ensureCollection` does list → create → upload without any uniqueness guarantee. If two fresh
  devices log in around the same time, both see an empty list and each uploads its own
  `workout-tracker.sessions` collection. Afterwards `existing.data[0]` may resolve differently per
  device, so the two devices sync into different collections and never converge — with no error
  shown. Consider: after upload, re-list and prefer a deterministic winner (e.g. lowest uid),
  migrating items if the local cache points at the loser.
  — _Took both halves. Re-lists after upload and every device picks the lowest uid, so the
  winner is the same everywhere; a collection that loses is only ever the empty one just
  created, so abandoning it strands nothing. The re-list alone does **not** close the race
  though — a device can create, re-list before the other's upload is visible, and cache a
  collection that later loses — so the cache is also confirmed against the server once per app
  start, and a device on the loser drops its sync bookkeeping and re-pushes into the winner.
  Dropping the bookkeeping is the load-bearing part of that migration: it is what marks a
  session as synced, so keeping it would leave every session looking clean and strand them in
  the abandoned collection. The extra cost is one list request per app start, not per sync._

- [x] **8. Duplicate `v-for` key in TempoInput** — `src/components/session/TempoInput.vue:9-11,46`
  `labels = ['Down', 'Hold', 'Up', 'Hold']` is rendered with `:key="label"`, so two columns share
  the key `"Hold"`. Vue logs a duplicate-key warning and keyed patching can mis-match nodes. Use
  `:key="i"` or give the labels distinct ids.

- [x] **9. IndexedDB failures are invisible and leave memory/DB diverged** — `src/App.vue:32`, `src/stores/sessions.ts:84-88`
  `sessions.load().then(() => sync.init())` has no `.catch` — if IDB is unavailable (e.g. some
  private-browsing modes, storage pressure), the app renders an empty state with no explanation
  and `sync.init()` never runs. Similarly, every mutation updates the reactive state *before*
  `putSession` resolves; if the write rejects (quota), the UI shows data that evaporates on
  reload, and the rejection surfaces only as an unhandled promise rejection. Add a top-level
  catch with a snackbar, and consider surfacing persist failures.
  — _Both surfaced as error snackbars: the `load()` chain now has a `.catch`, and a rejected
  write sets `storageError` on the sessions store, which App.vue watches. The write path also
  no longer broadcasts to other tabs when the write failed — peers react by re-reading the
  session, so announcing a write that never landed only wasted a read. Memory is deliberately
  **not** rolled back to the stored version: mutations are fired from click handlers that never
  await them, so by the time a rejection arrives the session may have been mutated again and
  there is no version it would be correct to restore. The user is told the data is not saved;
  reconciling it is not attempted._

- [x] **10. No automated tests for the sync engine** — project-wide
  `syncSessions`, the dirty-tracking via `syncedUpdatedAt`, tombstone propagation, and the stoken
  pagination are exactly the kind of subtle logic that regresses silently (findings 3, 4, 7 all
  live there). The logic is already well-factored for testing (`applyRemote` is injected; the db
  layer is a thin module easy to fake). A vitest suite with a faked item manager would cover the
  pull/push matrix cheaply. The Playwright `verify` skill covers the happy path only.
  — _26 vitest cases in `src/services/etesync.test.ts`, against an in-memory item manager
  (`etesync.fake.ts`) and db (`db.fake.ts`); `pnpm test`, and CI runs it. Covers the pull/push
  matrix, batching, stoken pagination, tombstones, and one case per subtlety the earlier findings
  turned up: skipping malformed items without wedging (#3), the tie-break and the `- 1` that
  keeps a local winner dirty (#4), and collection convergence plus the migration off a losing
  cache (#7). The suite was checked by mutation rather than by watching it go green: reverting
  `pickCollection` to `data[0]`, making `decodeSession` rethrow, dropping the `- 1`, making
  `compareSessions` give up on ties, and stopping pagination after one page each fail exactly the
  tests that describe them. One production change came out of writing it — the once-per-app-start
  collection check is keyed on the account rather than a module flag, which is both what a test
  can simulate a restart with and more correct after a re-login as a different user._

- [x] **11. CI never runs the linter** — `.github/workflows/build.yml:27-32`
  `pnpm build` runs type-check + build, but `pnpm lint` is only ever run manually. Add it to the
  Build workflow so style/correctness rules (the repo has a full eslint-config-vuetify setup)
  actually gate pushes.

- [x] **12. Font payload: 12 Roboto variants + full icon font precached** — `vite.config.mts:19-33`
  unplugin-fonts loads Roboto in 6 weights × 2 styles, and `@mdi/font` ships the entire
  Material Design Icons font (~400 KB woff2 alone); `globPatterns` includes `woff2`, so all of it
  lands in every user's service-worker precache on install and after each deploy. Vuetify
  typically needs weights 400/500/700, rarely italics; and `@mdi/js` (tree-shaken SVG paths, via
  `aliases`/`sets` in the Vuetify config) would eliminate the icon font entirely.
  — _Understated, if anything: fontsource emits each variant once per unicode subset, and there
  are 8 of those, so the 12 variants were **96** Roboto files. Measured precached woff2 went from
  1795 KB (97 files) to 340 KB (24), and the CSS bundle from 704 KB to 272 KB. Took both
  suggestions: weights cut to 400/500/700 normal (grepped the templates — that is exactly what
  the app renders; nothing uses italics or thin/black), and `@mdi/js` via `aliases`/`sets` with
  the app's 13 icons named in `plugins/vuetify.ts`. Subsets are deliberately left alone: dropping
  latin-ext would break accented exercise names. Removing the icon font also made the
  `remove-mdi-font-preloads` vite plugin dead code, so it is gone. Verified in a real browser —
  every `.v-icon` resolves to a non-empty SVG path, no webfont is requested, no console errors._

- [x] **13. Logout during an in-flight sync resurrects sync bookkeeping** — `src/stores/sync.ts:67-84`
  `logout()` clears `syncMeta`/`meta` while a running `syncSessions` may still `putSyncMeta` /
  `setMeta` afterwards, leaving orphaned rows (stale collection cache, stoken, item caches) that a
  *future* login on a different account would then trust — `ensureCollection` would load a cached
  collection belonging to the old account and fail confusingly. Await/cancel the in-flight sync
  before clearing (e.g. keep the `syncNow` promise and `await` it in `logout`), or guard db writes
  with an epoch/generation check.
  — _Took the await, not the epoch check: `syncNow` now keeps its run in `inFlightSync` and
  `logout` waits on it. Ordering inside `logout` turned out to matter beyond what the finding
  describes — a sync that *succeeds* mid-logout also re-stamps `lastSyncAt` and rewrites its
  localStorage key, so only the saved session (which is what makes `configured` false and stops
  new runs from starting) is dropped before the await; every other clear happens after it. The
  single-flight guard moved out into `syncNow`, leaving the sync body as `runSync`._

## LOW

- [x] **14. `sessionsStore.load()` has a concurrency race** — `src/stores/sessions.ts:17-23`
  `loaded` is set only after the `await`, so two concurrent callers both fetch and the second
  assignment clobbers `sessions.value` (and any session started in between). Currently only
  App.vue calls it once; cache the promise instead of the boolean to make it safe.
  — _Folded into finding #2: `load()` now caches its promise, which also keeps the new
  cross-tab subscription from registering twice._

- [x] **15. `getDB` caches a rejected promise forever** — `src/services/db.ts:33-47`
  If `openDB` rejects once, every later call reuses the rejected `dbPromise` until a full reload.
  Reset `dbPromise` on rejection.
  — _Folded into finding #9: retrying the open is what makes the new error snackbar actionable,
  since some causes (a blocking upgrade in another tab, storage pressure) clear on their own._

- [x] **16. `clearSyncState` wipes the generic `meta` store** — `src/services/db.ts:81-85`
  The store is named/typed as generic app metadata but logout clears it wholesale. Fine today
  (only etesync keys live there), a foot-gun the moment anything else is stored. Either rename the
  store `syncMeta2`/scope it, or delete only `etesync.*` keys.
  — _Folded into finding #13, since both are about logout clearing more than it should. Deletes
  only the `etesync.*` keys; the prefix is now exported as `SYNC_META_PREFIX` and the etesync
  service builds its key names from it, so the two cannot drift apart._

- [x] **17. Stepper minus button can't reach `min` when the value isn't step-aligned** — `src/components/session/StepperField.vue:4`
  Disable condition is `model - step < min`, so Weight = 1 kg with step 2.5 can never be
  decremented to 0 even though `round()` would clamp it. Disable on `model <= min` instead and let
  the clamp do its job.

- [x] **18. Decimal comma is rewritten to a dot mid-typing** — `src/components/session/StepperField.vue:52-56`
  `onInput` parses with `,`→`.` replacement but the `watch` that resyncs `text` compares with a
  plain `parseFloat`, so typing `7,5` snaps the field to `7.5`. Cosmetic, but jarring for
  comma-locale users; apply the same normalization in both places.

- [x] **19. Exercise-name prefill can overwrite user-adjusted fields** — `src/components/session/WorkoutEntryDialog.vue:166-178`
  `onNamePicked` re-applies the last entry's weight/reps/sets/tempo every time the combobox model
  changes to a known name. If the user picks a name, tweaks the weight, then edits the name text
  and re-commits it, their adjustments are silently reset. Only prefill when the name field was
  previously empty, or when values are still at their defaults.

- [x] **20. Clickable `div`s aren't keyboard-accessible** — `src/pages/SessionPage.vue:46-51`, `src/components/session/BreakEntryRow.vue:2-6`
  `role="button"` without `tabindex="0"` and Enter/Space handlers means the note editor and break
  rows can't be operated by keyboard. Add both, or use a real `<button>`/`v-btn variant="text"`.

- [x] **21. Multiple unfinished sessions are indistinguishable** — `src/stores/sessions.ts:31-33`, `src/pages/HomePage.vue:110-112`
  After a sync merge, several sessions can have `endTime === undefined`; `activeSession` picks the
  newest and the rest silently appear in "Previous sessions" looking finished. Consider marking
  open sessions in the list (e.g. "in progress") and offering finish from there.

- [x] **22. Light-theme flash on startup for dark-mode users** — `src/plugins/vuetify.ts:5-9`, `src/App.vue:34-36`
  Vuetify boots with `defaultTheme: 'light'` and the store's darkMode is applied via a watcher
  after mount. Read `localStorage.darkMode` directly in `vuetify.ts` when choosing
  `defaultTheme`. Related: the static `<meta name="theme-color" content="#1976D2">` in
  `index.html` doesn't match the dark theme UI chrome.

- [x] **23. Fixed action bar hard-codes the nav height and ignores iOS safe areas** — `src/pages/SessionPage.vue:239-246`
  `bottom: 56px` mirrors `v-bottom-navigation`'s default height; in iOS standalone mode the home
  indicator overlaps the nav because nothing accounts for `env(safe-area-inset-bottom)`. Add
  `viewport-fit=cover` + safe-area padding, or use Vuetify layout so the offset is computed.

- [x] **24. README project structure and code comments are stale** — `README.md:37-48`, `src/types/workout.ts:34`
  The structure block omits `services/`, `components/session/`, `utils/`, and the sessions/sync
  stores; `Session.updatedAt` is still documented as "used by the *future* sync layer". Also the
  intro's "account-free — your data stays on your device" deserves a "(unless you enable sync)"
  qualifier.
  — _Rewrote the structure block (added `services/`, `components/session/`, `utils/`, `types/`,
  `router/`, and the sessions/sync stores) and qualified the intro line. The `Session.updatedAt`
  comment was already corrected by finding #4's work — it now points at `nextUpdatedAt`, with no
  "future sync layer" language left — so only the README needed changing._

- [x] **25. `define: { 'process.env': {} }` is a legacy shim** — `vite.config.mts:76`
  It blindly rewrites any `process.env` reference in dependencies to `{}` and can mask real env
  handling. If no dependency still needs it (it came from the template), drop it and see if the
  build still passes.
  — _Nothing references `process.env` anywhere in `src/`, so the shim was dropped and
  `vite build` still passes cleanly. Handled together with #26 as template build cruft._

- [x] **26. Unused dependencies** — `package.json:25,41`
  Nothing imports `workbox-window` (vite-plugin-pwa's auto-injected registration doesn't need it),
  and `workbox-build` is bundled inside vite-plugin-pwa already. Remove both unless the versions
  are pinned intentionally for the plugin's peer resolution.
  — _Removed both from `package.json` and regenerated `pnpm-lock.yaml`. They are non-optional
  peerDependencies *and* regular dependencies of vite-plugin-pwa, so they stay in the tree as
  transitive deps of the plugin (still resolved at the same `7.4.1`); dropping the top-level
  entries only removes the redundant direct declarations. `pnpm install --frozen-lockfile` and
  `vite build` both pass._

- [x] **27. Deploy rsync never deletes removed files** — `.github/workflows/deploy.yml:49-51`
  Without `--delete`, old hashed assets accumulate on the server forever. For a PWA that's partly
  a feature (long-offline clients can still fetch old chunks), but it should be a documented
  decision — otherwise add `--delete` plus a grace strategy.
  — _Documented rather than changed. The finding names the reason `--delete` is risky here — a
  client offline across a deploy still requests the old content-hashed chunk names from its cached
  `index.html` until the service worker updates, and `--delete` would 404 them — so the omission
  is deliberate. Added a comment on the rsync step spelling out the trade-off and that stale
  assets get pruned manually._

- [x] **28. `toSorted`/`toReversed` set the browser floor at ~2023** — `src/stores/sessions.ts:28,38,49`
  These need Chrome 110 / Safari 16 / Firefox 115. Reasonable for a modern PWA, but there's no
  browserslist/build target declaring it, so an older phone gets a white screen instead of a
  graceful message. Either set `build.target` accordingly and document it, or use `[...x].sort()`.
  — _Took the first option, not `[...x].sort()`: the repo's eslint config (`unicorn/no-array-sort`,
  `no-array-reverse`) actively enforces `toSorted`/`toReversed`, so rewriting them fights the
  linter and would have to be undone. Instead declared the floor explicitly — `build.target`
  set to `chrome110/edge110/firefox115/safari16` in `vite.config.mts` (with a comment noting
  esbuild doesn't polyfill these, so it's a documented minimum not a transpile fix) and a
  "Browser Support" section in the README. Build still passes._

- [x] **29. Deleting a session irreversibly wipes its entries with no undo** — `src/stores/sessions.ts:146-154`
  The tombstone keeps only the husk (`entries = []`), so the confirm dialog is the sole guard
  against fat-fingering away a whole workout. Keeping entries in the tombstone would enable an
  "Undo" snackbar and cost almost nothing (tombstones already sync).
  — _Did exactly that. `deleteSession` no longer clears `entries`, a `restoreSession` flips the
  tombstone back, and the delete snackbar now carries an "Undo" action. The snackbar gained an
  optional action (label + handler) in the app store and an `#actions` slot in App.vue, with a
  longer timeout (6 s) when one is present so there's time to hit it. Restoring undeletes the same
  session id, so it re-appears with its entries intact; visibleSessions still filters tombstones,
  so nothing leaks into the UI or history in the meantime._

- [x] **30. Login form lacks autocomplete hints** — `src/components/settings/EtesyncSettings.vue:19-31`
  Add `autocomplete="username"` / `autocomplete="current-password"` (and `name` attributes) so
  password managers behave, especially inside an installed PWA.
