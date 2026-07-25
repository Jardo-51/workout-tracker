# Workout Tracker

A Vue 3 PWA for tracking your workouts. Installable, offline-capable, and account-free — your data stays on your device (unless you enable Etesync sync).

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Vue 3 (Composition API) + TypeScript |
| UI | Vuetify 4 + Material Design Icons |
| State | Pinia |
| Routing | Vue Router |
| Build | Vite + vite-plugin-pwa |

## Getting Started

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Build for production
pnpm build

# Lint
pnpm lint
```

Alternatively, if you use [Nix](https://nixos.org/), you can run commands via the project's dev shell:

```bash
nix develop -c pnpm dev
```

## Project Structure

```
src/
├── pages/           # Route-level page components
├── components/
│   ├── layout/      # Bottom navigation
│   ├── session/     # Workout/break entry editors, history, steppers
│   └── settings/    # Theme toggle, weight unit, Etesync sync, JSON backup
├── services/        # IndexedDB, Etesync sync engine, cross-tab broadcast, backup format
├── stores/          # Pinia stores (app, sessions, sync)
├── utils/           # Formatting and error helpers
├── types/           # Shared TypeScript types
├── plugins/         # Vuetify, Pinia, Router config
├── router/          # Route definitions
└── main.ts          # App entry point
```

## Browser Support

Targets modern evergreen browsers — **Chrome/Edge 110+, Firefox 115+, Safari 16+**
(roughly 2023 onward). The app uses ES2023 array methods (`toSorted`/`toReversed`)
that aren't polyfilled, so older browsers are unsupported by design; this floor is
declared in `build.target` in `vite.config.mts`.

## PWA & Offline Support

- Installable on mobile and desktop — runs as a standalone app
- Full offline functionality via service worker caching
- Auto-updates when a new version is deployed
- No account required — your data stays on your device (IndexedDB)

## Backup & Restore (JSON)

Settings → Backup exports every workout to a JSON file
(`workout-tracker-export-<date>_<time>.json`) and imports one back. The file is
plain, readable JSON — a `sessions` array, the timestamp it was written at, and
an `app`/`version` pair naming the format — so it doubles as a way to get the
data out of the app for good. An import checks that pair first: without it a
file is only recognisable by having something shaped like sessions in it, which
another app's export could be too.

Import **merges**, and asks for confirmation before it does. A workout the file
has and the device does not is added; one both have is resolved last-write-wins,
by the same comparison the sync engine uses; one only the device has is left
alone. A restore is not a way to force an old copy over a newer one. To restore
a file and nothing else, *Clear all workouts* first — an exact restore is then
something you ask for rather than something an import does to you.

The file holds deleted sessions as well, as the tombstones sync uses, so it is a
copy of the whole device rather than only the part of it worth reading.
That is what lets a restore reproduce the deletions too, and what makes clearing
first work: a workout the file still has and the device has only as a tombstone
is restored whatever the timestamps say, since a tombstone holds nothing of
yours to lose. It is the one place the import overrides the comparison.

The file is parsed and validated first: a session or entry this version cannot
read aborts the whole import with the reason, since imported data is persisted
and pushed to sync, where anything malformed would outlive the import.

Merging is also the only behaviour that does not depend on a setting in another
card. An import that replaced the local sessions only really replaced anything
with sync switched off — with sync on, the next run pulled the account back down
and the end state was this same merge. The destructive version was not a second
way of restoring, it was this one plus a data loss.

**Clear all workouts** deletes every session and the entries and notes on it.
What it leaves behind depends on whether you are logged in to sync, and the
confirmation dialog says which one you are about to get:

- **Logged in**, each session is kept as a bare tombstone — no content, just an
  id and a timestamp — for the same reason a single deleted session is: that is
  what carries the deletion to your other devices on the next sync. Removing the
  rows outright would leave the server copies alone and the next sync would pull
  everything straight back. So this clears the account, not just the device.
- **Logged out**, the rows go too and nothing is left. Tombstones would outlive
  the clear carrying a stamp newer than anything on the server, so logging back
  in later would push them and take the account's data with them — a device
  clear turning into an account clear, just deferred. Logging in again re-pulls
  the account's workouts the way any other fresh device does.

So log out first if you want to clear this device and keep what is on the
server.

## Etesync Sync (optional)

Workout data can be synced across devices through an [Etesync](https://www.etesync.com/)
(Etebase) server — end-to-end encrypted. Enter your server URL, username, and
password under Settings → Etesync sync. Sync runs automatically a few seconds
after each change and whenever the app comes back online; changes made offline
are pushed on reconnect. Conflicts resolve last-write-wins per session, and
deletions propagate. Logging out keeps all local data.

Last-write-wins is decided by each session's `updatedAt` stamp, which is kept
strictly increasing per session rather than read straight off the clock — a
device whose clock jumps backwards can't lose its own newer edits, and an edit
based on a session pulled from a device running ahead still wins. Resolution is
per whole session, though: if the *same* session is edited on two devices
between syncs, the losing device's entries for it are discarded rather than
merged.

### What the encryption does and does not cover

Sync is end-to-end encrypted: the server stores ciphertext and never sees a
password or a workout. What that protects is the data in transit and on the
server — not the data on a device you have logged in on.

Staying logged in means keeping the Etebase session, and that session contains
the account's key material. It is held in `localStorage`, so anything that can
run JavaScript in the app's origin can read it and decrypt everything the
account has on the server. The [CSP](public/.htaccess) is the main defence
here: no inline script, no third-party script, so there is little to work with
short of a compromised dependency.

Storing it elsewhere would not change that. IndexedDB is the same origin, and
so is any key used to wrap the session with `Account.save(encryptionKey)` — the
app would have to keep that key somewhere it can read unattended, which means
an attacker running in the origin can read it too. The only version of this
with real teeth is deriving the key from a passphrase the user types on every
app start, which is exactly the friction this app is built to avoid.

So: treat being logged in as trusting the device and its browser profile. If
that is not a trade you want on some device, do not enable sync there.

## Dark Mode

- Toggle between light and dark themes from settings
- Preference persists across sessions

## Deployment

GitHub Actions workflows are included:

- **Build** — runs on every push, validates the project compiles
- **Deploy** — manual trigger, builds and deploys via `rsync` over SSH

Required repository secrets for deployment:

| Secret | Description |
|---|---|
| `DEPLOY_KEY` | SSH private key |
| `DEPLOY_HOST_KEY` | Known hosts entry for the target server |
| `DEPLOY_URL` | rsync destination (e.g. `user@host:/var/www/app/`) |
