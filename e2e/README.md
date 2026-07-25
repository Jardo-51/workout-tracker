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

## The two suites

`backup.spec.ts` runs on a device with sync switched off and needs nothing but
the app. `sync-backup.spec.ts` drives two browser contexts as two devices
against a real Etesync server, and **skips itself** unless one is configured —
so the default run stays self-contained.

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

## Conventions

- Drive the app the way a user does: bottom nav, buttons, dialogs. The one
  exception is `storedSessions`, which reads IndexedDB, because "a tombstone or
  no row at all" is exactly what several of these tests are about and it is
  invisible on screen.
- Assert with `expect`, which retries. No sleeps: waiting for a sync means
  waiting for the button to stop loading, not for four seconds to pass.
- Snackbars sit over the bottom nav and swallow clicks aimed at it — the
  helpers call `settle()` before navigating, which returns at once when there
  is no snackbar up.
