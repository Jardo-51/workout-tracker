import { expect, test } from '@playwright/test'
import {
  entryCard,
  openApp,
  openHome,
  openSession,
  openSettings,
  recordWorkout,
  serviceWorkerReady,
  sessionRow,
} from './support/app'

/**
 * The service worker, which is what makes this an app the user can open rather
 * than a page they have to be online for. `VitePWA` precaches the build
 * (`globPatterns` in `vite.config.mts`) and workbox serves navigations out of
 * it, and nothing here is visible until the network is gone: online, every
 * assertion below passes with the worker deleted.
 *
 * `sync.spec.ts` reloads a device offline too, but incidentally — that test is
 * about the `online` listener flushing what was recorded, and it needs an
 * Etesync server, so a default run skips it and the precache goes unchecked.
 * This one is about the precache itself and needs nothing but the app.
 */
test.describe('the app with the network down', () => {
  test('reloads, routes and finds its workouts still there', async ({ page }) => {
    await openApp(page)
    await recordWorkout(page, 'Deadlift', { weight: 100, reps: 3 })
    await serviceWorkerReady(page)

    await page.context().setOffline(true)
    await page.reload()

    // The app came back at all: `index.html` and the entry bundle were served
    // by the worker, since nothing could have fetched them.
    await openHome(page)
    // And with the workouts it had. IndexedDB never needed the network, but a
    // Home that renders an empty list would say the app booted without the
    // data it is for.
    await expect(sessionRow(page)).toHaveCount(1)

    // Each route is a chunk of its own (`router/index.ts` imports the three
    // pages lazily), and only Home's has been fetched so far — the session and
    // settings chunks are being asked for here for the first time on this page,
    // with nowhere but the precache to come from. A `globPatterns` that stopped
    // covering them would leave the app booting and then failing to navigate,
    // which is exactly what these two lines catch.
    await openSession(page, '1 exercises')
    await expect(entryCard(page, 'Deadlift')).toContainText('100 kg × 3 reps')
    await openSettings(page)

    // A cold start on a URL that no file corresponds to: `/settings` is a
    // client-side route, so this is workbox's navigate fallback handing back
    // the precached `index.html` and the router taking it from there. The
    // in-app navigation above cannot show this — it never made a document
    // request — and it is what a user reopening an installed app does.
    await page.goto('/settings')
    await expect(page.getByText('Backup', { exact: true })).toBeVisible()
  })
})
