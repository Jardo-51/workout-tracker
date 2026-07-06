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

## Selector gotchas

- Closed Vuetify dialogs stay mounted: scope entry cards with `.v-card.mb-2`,
  overlays with `.v-overlay--active`.
- The combobox open menu also matches `getByLabel('Exercise')` — use
  `getByRole('combobox', { name: 'Exercise' })`.
- Stepper rows: `page.locator('div.ga-2.mb-3').filter({ has: page.getByLabel('Weight') })`,
  first button = minus, last = plus.
