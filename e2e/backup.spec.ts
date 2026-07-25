import fs from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
  chooseBackupFile,
  clearAllWorkouts,
  confirmClear,
  deleteNewestWorkout,
  exportBackup,
  importBackup,
  openApp,
  openClearDialog,
  openHome,
  recordWorkout,
  snackbar,
  storedSessions,
  visibleSessions,
} from './support/app'

/**
 * Backup on a device with sync switched off. The synced half of the feature —
 * where a clear leaves tombstones rather than nothing, and a restore has to
 * beat them — is in sync-backup.spec.ts, which needs a server.
 */
test.describe('backup, without sync', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('exports the whole device, and says how many workouts that is', async ({ page }, testInfo) => {
    await recordWorkout(page, 'Squat')
    await recordWorkout(page, 'Bench press')
    await deleteNewestWorkout(page)

    const { backup, suggestedFilename } = await exportBackup(
      page,
      testInfo.outputPath('export.json'),
    )

    expect(suggestedFilename).toMatch(
      /^workout-tracker-export-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/,
    )
    // The markers parseBackup checks before it trusts anything else.
    expect(backup).toMatchObject({ app: 'workout-tracker', version: 1 })
    expect(backup.exportedAt).toEqual(expect.any(String))
    // Both sessions: the file is a copy of the device, so the deleted one
    // travels as the tombstone that carries the deletion.
    expect(backup.sessions).toHaveLength(2)
    expect(backup.sessions.filter(session => session.deleted)).toHaveLength(1)
    // ...while the count the user is given is about workouts.
    await expect(snackbar(page)).toHaveText('Exported 1 workout(s)')
  })

  test('clearing leaves nothing behind, and the file puts it all back', async ({ page }, testInfo) => {
    await recordWorkout(page, 'Squat')
    const { backup, path } = await exportBackup(page, testInfo.outputPath('export.json'))

    const dialog = await openClearDialog(page)
    await expect(dialog).toContainText('Nothing is left behind on this device')
    await confirmClear(dialog)
    // Logged out the rows go too, or they would push on a later login and take
    // the account's data with them.
    expect(await storedSessions(page)).toHaveLength(0)

    await importBackup(page, path)

    await expect(snackbar(page)).toHaveText('Imported 1 workout(s)')
    expect(await visibleSessions(page)).toEqual(backup.sessions.filter(s => !s.deleted))
    await openHome(page)
    await expect(page.locator('.v-list-item')).toHaveCount(1)
  })

  test('merges into what is already there, without deleting it', async ({ page }, testInfo) => {
    await recordWorkout(page, 'Squat')
    const { path } = await exportBackup(page, testInfo.outputPath('squat.json'))

    // A second device's worth of history, which the file knows nothing about.
    await clearAllWorkouts(page)
    await recordWorkout(page, 'Deadlift')
    await importBackup(page, path)

    const names = (await visibleSessions(page))
      .flatMap(session => session.entries.map(entry => 'name' in entry ? entry.name : entry.kind))
    expect(names.toSorted()).toEqual(['Deadlift', 'Squat'])
  })

  test('reports what is wrong with a file it cannot read, before touching anything', async ({ page }, testInfo) => {
    await recordWorkout(page, 'Squat')
    const before = await storedSessions(page)

    const broken = testInfo.outputPath('broken.json')
    await fs.writeFile(broken, JSON.stringify({
      app: 'workout-tracker',
      version: 1,
      sessions: [{ id: 'x', dateKey: '7. 7. 2026', startTime: 1, updatedAt: 1, entries: [] }],
    }))
    await chooseBackupFile(page, broken)

    await expect(snackbar(page)).toHaveText(/Import failed:.*dateKey is not YYYY-MM-DD/)
    // No confirmation was ever asked for, and nothing was replaced.
    await expect(page.getByText('Import backup?')).toBeHidden()
    expect(await storedSessions(page)).toEqual(before)
  })

  test('refuses a file that is not ours at all', async ({ page }, testInfo) => {
    const foreign = testInfo.outputPath('foreign.json')
    await fs.writeFile(foreign, JSON.stringify({ sessions: [] }))

    await chooseBackupFile(page, foreign)

    await expect(snackbar(page)).toHaveText(/not a workout-tracker export/)
  })
})
