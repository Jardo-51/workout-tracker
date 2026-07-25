import type { Browser, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  clearAllWorkouts,
  confirmClear,
  exportBackup,
  importBackup,
  logIn,
  openApp,
  openClearDialog,
  recordWorkout,
  snackbar,
  storedSessions,
  syncNow,
  visibleSessions,
} from './support/app'
import { accountFromEnv, ensureAccount } from './support/etebase'

/**
 * Backup on a device that syncs, driven as two devices against a real server.
 *
 * This is where the feature's hard cases live: a clear here leaves tombstones
 * that reach the account, so a restore has to beat them — locally *and* on the
 * other device, which still holds the tombstone it pulled. See e2e/README.md
 * for the server these want.
 */
const account = accountFromEnv()

test.describe('backup, with sync', () => {
  test.skip(!account, 'set E2E_ETEBASE_URL to run the sync tests — see e2e/README.md')
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    await ensureAccount(account!)
  })

  test('a clear and an import both reach the account', async ({ browser }, testInfo) => {
    const deviceA = await openDevice(browser)
    const deviceB = await openDevice(browser)

    await logIn(deviceA, account!)
    // The account outlives the run, so start from whatever it holds: clearing
    // is the app's own way of emptying it, and makes this repeatable.
    await emptyTheAccount(deviceA)

    await recordWorkout(deviceA, 'Squat')
    await recordWorkout(deviceA, 'Deadlift')
    await syncNow(deviceA)
    expect(await visibleSessions(deviceA)).toHaveLength(2)

    await logIn(deviceB, account!)
    await syncNow(deviceB)
    expect(await visibleSessions(deviceB)).toHaveLength(2)

    const { backup, path } = await exportBackup(deviceA, testInfo.outputPath('export.json'))
    expect(backup.sessions.filter(session => !session.deleted)).toHaveLength(2)

    const dialog = await openClearDialog(deviceA)
    await expect(dialog).toContainText('They go from the sync server and your other devices too')
    await confirmClear(dialog)
    // Logged in the rows stay as bare tombstones: that is what pushes the
    // deletion, where removing them would leave the server copies to come back.
    const cleared = await storedSessions(deviceA)
    expect(cleared).toHaveLength(2)
    expect(cleared.every(session => session.deleted)).toBe(true)
    expect(cleared.every(session => session.entries.length === 0)).toBe(true)

    await syncNow(deviceA)
    await syncNow(deviceB)
    expect(await visibleSessions(deviceB)).toHaveLength(0)

    // The documented way to ask for an exact restore: clear, then import.
    await importBackup(deviceA, path)

    await expect(snackbar(deviceA)).toHaveText('Imported 2 workout(s)')
    const restored = await visibleSessions(deviceA)
    expect(restored).toHaveLength(2)
    for (const session of restored) {
      const original = backup.sessions.find(candidate => candidate.id === session.id)!
      expect({ ...session, updatedAt: 0 }).toEqual({ ...original, updatedAt: 0 })
      // Above the tombstone it replaced, or the copy the server already has
      // wins over it on the next run and the restore is undone.
      expect(session.updatedAt).toBeGreaterThan(original.updatedAt)
    }

    // Landing is not enough — it has to survive the round trip.
    await syncNow(deviceA)
    await syncNow(deviceB)
    expect(await visibleSessions(deviceB)).toHaveLength(2)

    await syncNow(deviceA)
    await syncNow(deviceB)
    expect(await visibleSessions(deviceA)).toHaveLength(2)
    expect(await visibleSessions(deviceB)).toHaveLength(2)
  })
})

async function openDevice (browser: Browser): Promise<Page> {
  // A context per device: separate IndexedDB, separate saved Etebase session.
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  await openApp(page)
  return page
}

/** Leaves the account with no workouts in it, whatever a previous run left. */
async function emptyTheAccount (page: Page) {
  await syncNow(page)
  if ((await visibleSessions(page)).length > 0) {
    await clearAllWorkouts(page)
    await syncNow(page)
  }
}
