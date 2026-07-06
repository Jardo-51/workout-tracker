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
