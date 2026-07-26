import { expect, test } from '@playwright/test'
import {
  clearAllWorkouts,
  emptyTheAccount,
  entryCard,
  exportBackup,
  fillWorkoutValues,
  holdSyncLock,
  importBackup,
  logIn,
  openApp,
  openDevice,
  openEntry,
  openSession,
  openTab,
  pressSyncNow,
  recordWorkout,
  releaseSyncLock,
  saveEntry,
  sessionRow,
  syncNow,
  visibleSessions,
} from './support/app'
import { syncedDescribe } from './support/etebase'

/**
 * Two tabs of one device — the case `services/broadcast.ts` exists for, and the
 * one no other spec reaches. `sync.spec.ts` drives two browser *contexts*,
 * which are two devices with an IndexedDB each; two tabs share one, so neither
 * of them learns from the database that the other wrote to it.
 *
 * The three things that make that survivable are what is covered here: a
 * per-session message for an ordinary write, a wholesale one for a clear or an
 * import, and a lock so two tabs cannot sync the same account at once. Only the
 * last needs a server, and it sits in its own describe that skips without one.
 */
test.describe('two tabs of one device', () => {
  test('carries a write in one tab through to the other', async ({ page }) => {
    await openApp(page)
    const other = await openTab(page)

    await recordWorkout(page, 'Squat', { weight: 60, reps: 5 })

    // Nothing reloaded: the second tab is showing a session it was told about.
    // Asserted down to the entry, not just the row — `onSessionChanged` carries
    // an id and nothing else, so the tab has to go and read the session itself
    // for this to be what the user typed rather than an empty placeholder.
    await expect(sessionRow(other)).toHaveCount(1)
    await openSession(other, '1 exercises')
    await expect(entryCard(other, 'Squat')).toContainText('60 kg × 5 reps')

    // And back the other way, on a session both tabs now hold in memory: the
    // tab that has only been listening writes, and the first one has to give up
    // the copy it is sitting on. A tab that kept it would push it back over the
    // top on its own next mutation.
    await openEntry(other, 'Squat')
    await fillWorkoutValues(other, { weight: 65 })
    await saveEntry(other)

    await openSession(page, '1 exercises')
    await expect(entryCard(page, 'Squat')).toContainText('65 kg × 5 reps')
  })

  test('empties and refills the other tab when every session is replaced at once', async ({ page }, testInfo) => {
    await openApp(page)
    await recordWorkout(page, 'Squat')
    const { path } = await exportBackup(page, testInfo.outputPath('export.json'))

    const other = await openTab(page)
    await expect(sessionRow(other)).toHaveCount(1)

    // The case a per-session message cannot carry: the sessions a clear removed
    // have no id left for a peer to be told about, so the second tab is sent
    // "everything changed" and re-reads the lot. Without that it would sit on a
    // session that no longer exists — and write it back to disk on its next
    // mutation, undoing half of what the user asked for in the other tab.
    await clearAllWorkouts(page)
    await expect(sessionRow(other)).toHaveCount(0)
    await expect(other.getByText('No workouts yet')).toBeVisible()

    // An import sends the same message, for the same reason in reverse.
    await importBackup(page, path)
    await expect(sessionRow(other)).toHaveCount(1)
    await openSession(other, '1 exercises')
    await expect(entryCard(other, 'Squat')).toBeVisible()
  })
})

/**
 * The sync lock, which is the one thing here that a fake server cannot show:
 * what it prevents is two runs racing the same stoken and item caches, and
 * those only mean anything against a real one. See e2e/README.md for the server
 * this wants.
 */
syncedDescribe('two tabs of one device on one account', account => {
  test('stops the second tab syncing while the first one is', async ({ browser }) => {
    // Above the suite's 120 s, for the same reason as the offline test in
    // sync.spec.ts: the poll at the end is allowed 60 of them, and two logins,
    // an emptying of the account and a recorded workout can eat the rest. The
    // failure this test is for has to land on the poll's own message rather
    // than on "Test timeout of 120000ms exceeded", which says nothing.
    test.setTimeout(180_000)

    const device = await openDevice(browser)
    const observer = await openDevice(browser)

    await logIn(device, account)
    // The account outlives the run and the other specs share it, so start from
    // whatever it holds — the app's own clear is how it is emptied.
    await emptyTheAccount(device)
    await logIn(observer, account)

    const other = await openTab(device)
    // Held from the first tab, which is what a tab in the middle of a sync is
    // doing. A real second run is not something this test could aim at: against
    // a local server one is over in milliseconds.
    await holdSyncLock(device)

    await recordWorkout(other, 'Deadlift', { weight: 100, reps: 3 })
    const [recorded] = await visibleSessions(other)
    // Pinned here rather than left to `recorded!.id` below, where a workout
    // that was never recorded reads as a lock that failed to hold.
    expect(recorded, 'the workout should have been recorded in the second tab').toBeDefined()

    // Deliberately not `syncNow`: that waits for the app to say a run happened,
    // and none may. The press is answered with nothing — `runSync` gets as far
    // as the lock, is refused, and never touches the account.
    await pressSyncNow(other)

    await syncNow(observer)
    expect(
      (await visibleSessions(observer)).map(session => session.id),
      'the refused sync should have pushed nothing',
    ).not.toContain(recorded!.id)

    await releaseSyncLock(device)

    // No press this time, on purpose: a refused run re-arms its own debounce,
    // so the workout reaching the account is the tab picking itself back up
    // rather than the button being pressed until it worked. The observer has to
    // keep asking, because that happens on the other device's schedule.
    await expect.poll(
      async () => {
        await syncNow(observer)
        return (await visibleSessions(observer)).map(session => session.id)
      },
      { message: 'the tab that was refused should sync once the lock is free', timeout: 60_000 },
    ).toContain(recorded!.id)

    await openSession(observer, '1 exercises')
    await expect(entryCard(observer, 'Deadlift')).toContainText('100 kg × 3 reps')
  })
})
