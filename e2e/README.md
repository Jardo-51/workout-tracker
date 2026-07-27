# End-to-end tests

Playwright, driving the **production build** in a browser: `pnpm build` and a
`vite preview` server are started by `playwright.config.ts`, so a run checks the
minified bundle, the lazy route chunks and the service worker, not the dev
server.

## Running them

The browsers cannot come from `playwright install` on this machine — the OS is
too old for them — so they come from nixpkgs instead, via the `playwright`
shell in `flake.nix`:

```sh
nix develop .#playwright -c pnpm test:e2e
```

That shell exports `PLAYWRIGHT_BROWSERS_PATH` (at `playwright-driver.browsers`)
and `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS`. Outside it, a run fails with
*"Executable doesn't exist"*.

CI runs them the same way (`.github/workflows/e2e.yml`), so the binary being
driven there is the one being driven here.

Useful variations:

```sh
nix develop .#playwright -c pnpm test:e2e backup.spec.ts   # one file
nix develop .#playwright -c pnpm test:e2e --headed         # watch it
nix develop .#playwright -c pnpm test:e2e --debug          # step through it
pnpm test:e2e:report                                       # last HTML report
```

### Keeping the versions in step

`playwright-driver.browsers` pins one set of browser revisions, and
`@playwright/test` in `package.json` is pinned exactly (no caret) to match.
Bump them together:

```sh
nix eval --raw 'github:NixOS/nixpkgs/nixos-26.05#playwright-driver.version'
pnpm add -D @playwright/test@<that version>
```

## The suites

`session.spec.ts` and `home.spec.ts` cover the two screens the app is actually
used through: recording, editing and removing entries and breaks in a session,
and what Home shows for each of the states it can be in. Between them they are
the only tests that render most of `components/session/`.

`settings.spec.ts` covers the Settings cards that are not Backup: the theme and
default-unit preferences, which live in localStorage and so are really a test
of what survives a reload, and the sync card's login and logout.

`multi-tab.spec.ts` is the one file about two *tabs* rather than two devices:
two pages in one context, sharing an IndexedDB, which is what
`services/broadcast.ts` exists for. A write in one tab showing up in the other
and a clear or an import emptying and refilling it need no server; the third
test, that a tab already syncing stops another from starting, does.

`backup.spec.ts` runs on a device with sync switched off and needs nothing but
the app. `sync.spec.ts` and `sync-backup.spec.ts` drive two browser contexts as
two devices against a real Etesync server, and **skip themselves** unless one is
configured — so the default run stays self-contained. The account half of
`settings.spec.ts` and the sync-lock half of `multi-tab.spec.ts` skip on the
same condition; the rest of those files always runs.

The two synced files split by what they are about. `sync.spec.ts` is sync
itself: a session and then its deletion travelling from one device to the
other, both devices editing the same session and having to agree on one copy
afterwards, and a device that recorded a workout while offline pushing it when
the connection comes back — nothing there involves a backup file.
`sync-backup.spec.ts` is what export, clear and import do to an account.

The synced tests are worth the setup: with sync on, *Clear all workouts* leaves
tombstones that reach the account, and a restore has to beat them on both
devices. That is the case that used to lose the data outright.

### Starting a server

```sh
docker run --rm -d --name etesync-test -p 8033:3735 \
  -e SUPER_USER=gymrat -e SUPER_PASS=correct-horse-battery \
  -e ALLOWED_HOSTS=127.0.0.1,localhost \
  victorrds/etesync:alpine
```

`ALLOWED_HOSTS` is required — the image's default wildcard makes starlette's
`TrustedHostMiddleware` return 500 for every request. The tests sign the
account up on first use (`e2e/support/etebase.ts`); this image only allows the
seeded user to sign up, which is why the credentials above match `SUPER_USER`.

Then point the tests at it:

```sh
E2E_ETEBASE_URL=http://127.0.0.1:8033 \
  nix develop .#playwright -c pnpm test:e2e
```

`E2E_ETEBASE_USERNAME` and `E2E_ETEBASE_PASSWORD` override the defaults
(`gymrat` / `correct-horse-battery`).

The account carries over between runs, so the test starts by clearing whatever
is in it — the app's own *Clear all workouts*, which is also the thing being
tested. A run therefore empties the account it is pointed at: use a throwaway
one, never an account with real workouts in it.

It also carries over between *specs*: more than one file logs into it now, they
run in file order under a single worker, and whichever runs first leaves its
sessions there. So a spec that uses the account must start by emptying it
(`emptyTheAccount`), and must not assert on totals of what came back from the
server — not row counts, not tombstone counts. A clear leaves its tombstones on
the account permanently and a login pulls every one of them down, so a total
only holds on an account nothing has ever been cleared from. Assert about the
sessions the test itself made, by id.

## Conventions

- Drive the app the way a user does: bottom nav, buttons, dialogs. Four
  reaches past that are allowed, for one reason: what those tests are about has
  no form on screen. `storedSessions` reads the rows, because "a tombstone or
  no row at all" is the difference several tests turn on; `storedKeys` and
  `storedSyncState` read localStorage and the sync bookkeeping, because what a
  logout leaves behind is what a later login would push at whatever account it
  is then given; `holdSyncLock`/`releaseSyncLock` take the app's own Web Lock
  and give it back — one reach, in two halves — because "another tab is
  syncing" is invisible *and* untimeable, a run against a local server being
  over in milliseconds, so a second tab has no window to be caught in. A fifth
  needs the same kind of argument, not merely that reaching in is easier.
- Assert with `expect`, which retries. No sleeps: waiting for a sync means
  waiting for the button to stop loading, not for four seconds to pass.
- Snackbars sit over the bottom nav and swallow clicks aimed at it — the
  helpers call `settle()` before navigating, which returns at once when there
  is no snackbar up. Where there is one, it clicks the message's Close button
  rather than waiting the timeout out, which is most of why a suite run is
  faster than it was; only a message offering an Undo has no close button and
  still has to be waited out.
