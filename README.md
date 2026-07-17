# Workout Tracker

A Vue 3 PWA for tracking your workouts. Installable, offline-capable, and account-free — your data stays on your device.

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
│   └── settings/    # Theme toggle
├── stores/          # Pinia stores (app: snackbar, dark mode)
├── plugins/         # Vuetify, Pinia, Router config
└── main.ts          # App entry point
```

## PWA & Offline Support

- Installable on mobile and desktop — runs as a standalone app
- Full offline functionality via service worker caching
- Auto-updates when a new version is deployed
- No account required — your data stays on your device (IndexedDB)

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
