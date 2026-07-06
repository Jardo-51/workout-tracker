---
name: verify
description: Build, launch, and drive the workout-tracker PWA headlessly to verify changes end-to-end with Playwright.
---

# Verifying the workout tracker

## Build & serve

```bash
nix develop -c pnpm build                      # runs vue-tsc + vite build into dist/
nix develop -c pnpm preview --port 4173        # serves dist/ (run in background)
```

Dev server alternative: `nix develop -c pnpm dev` (port 3000).

## Headless browser

The flake exposes a playwright shell (top-level `playwright` output, works with
`nix develop .#playwright`). It exports `PLAYWRIGHT_BROWSERS_PATH` and
`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS`.

**Gotcha: version pinning.** The npm `playwright-core` version must match the
nixpkgs `playwright-driver` browser revisions or launch fails with
"Executable doesn't exist". Check with:

```bash
nix eval --raw 'github:NixOS/nixpkgs/nixos-26.05#playwright-driver.version'
```

then `pnpm add playwright-core@<that version>` in a scratch dir (NOT the repo)
and run scripts via:

```bash
nix develop <repo>#playwright -c node drive.mjs
```

Use a mobile viewport (390×844, `isMobile: true`) — the UI is phone-first.

## Flows worth driving

- Home → "Start workout" → `/session/:id`; "+ Exercise" opens fullscreen dialog
  (combobox label "Exercise", role `combobox`), steppers for Weight/Reps/Sets,
  tempo +/- grid; "Add" appends a card.
- Reload mid-session → entry persists (IndexedDB `workout-tracker` / `sessions`);
  Home shows "Resume workout".
- "+ Break" bottom sheet: 60/90/120 s presets one-tap add, custom field.
- Re-adding the same exercise name prefills weight/reps/sets/tempo/unit from the
  last entry (select from combobox menu).
- History icon (`mdi-history`) on an entry card opens per-exercise history dialog.
- Finish/Reopen, note editing (tap "Add a note…", blur saves), entry edit
  (tap card), deletes (entry via dialog, session via home list, tombstoned in DB).
- Settings: kg/lbs toggle changes default unit for new entries only.

## Etesync sync verification

A local Etebase server can be run from nixpkgs (`etebase-server` 0.14.x):

1. Config ini (env `ETEBASE_EASY_CONFIG_PATH`): `[global] secret_file/media_root/static_root`
   (static_root dir must exist), `[allowed_hosts] allowed_host1 = *`,
   `[database] engine = django.db.backends.sqlite3, name = <path>`.
2. `nix shell nixpkgs#etebase-server -c etebase-server migrate`
3. Django `runserver` is broken (no wsgi module; the reloader also chokes on the
   nix wrapper). Run the ASGI app instead: extract PYTHONPATH + python via
   `etebase-server shell --command "import os,sys; print(sys.executable); print(os.environ['PYTHONPATH'])"`,
   then `python -m uvicorn etebase_server.asgi:application --port 8033`.
   CORS is allow-all out of the box.
4. Signup is disabled by default: create the user first with
   `etebase-server shell --command "from etebase_server.myauth.models import User; User.objects.create_user('u','u@example.com')"`,
   then `Etebase.Account.signup({username,email}, password, url)` initializes it.
5. A node script using the repo's `etebase` package (CJS `require('etebase')`)
   works for signup and for asserting server-side items; content is E2E
   encrypted so reading items requires logging in.
6. Drive two browser contexts as two devices: login via Settings, "Sync now"
   button, assert cross-device pull/merge/tombstone. `context.setOffline(true/false)`
   exercises the reconnect auto-sync ('online' event).

## Selector gotchas

- Closed Vuetify dialogs stay mounted: scope entry cards with `.v-card.mb-2`,
  overlays with `.v-overlay--active`.
- The combobox open menu also matches `getByLabel('Exercise')` — use
  `getByRole('combobox', { name: 'Exercise' })`.
- Stepper rows: `page.locator('div.ga-2.mb-3').filter({ has: page.getByLabel('Weight') })`,
  first button = minus, last = plus.
