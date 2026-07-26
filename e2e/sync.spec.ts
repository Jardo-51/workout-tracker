import { expect, test } from '@playwright/test'
import {
  deleteNewestWorkout,
  emptyTheAccount,
  entryCard,
  fillWorkoutValues,
  logIn,
  openDevice,
  openEntry,
  openHome,
  openSession,
  recordWorkout,
  saveEntry,
  sessionRow,
  snackbar,
  storedSessions,
  syncNow,
  visibleSessions,
} from './support/app'
import { accountFromEnv, ensureAccount } from './support/etebase'

/**
 * Sync itself, driven as two devices against a real server: a session made on
 * one reaching the other, a deletion doing the same, the two of them editing
 * the same session at once, and a device that was offline while the user
 * worked.
 *
 * `services/etesync.test.ts` covers the engine's rules — conflicts,
 * tie-breaking, unreadable remote items, pagination — but against
 * `etesync.fake.ts`, an in-memory stand-in. What it cannot say is whether the
 * rules hold over real crypto, real stokens and a real server's idea of what
 * changed since the last one, which is what these are for.
 *
 * `sync-backup.spec.ts` is the other half: the same two devices, but about
 * what export, clear and import do to an account. Neither file needs a backup
 * file to be involved here. See e2e/README.md for the server these want.
 */
const account = accountFromEnv()

test.describe('sync between two devices', () => {
  test.skip(!account, 'set E2E_ETEBASE_URL to run the sync tests — see e2e/README.md')
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    await ensureAccount(account!)
  })

  test('carries a workout to the other device, and its deletion after it', async ({ browser }) => {
    const deviceA = await openDevice(browser)
    const deviceB = await openDevice(browser)

    await logIn(deviceA, account!)
    // The account outlives the run and the other specs share it, so start from
    // whatever it holds — the app's own clear is how it is emptied.
    await emptyTheAccount(deviceA)
    await logIn(deviceB, account!)
    expect(await visibleSessions(deviceB)).toHaveLength(0)

    await recordWorkout(deviceB, 'Overhead press', { weight: 40, reps: 6 })
    const [recorded] = await visibleSessions(deviceB)
    await syncNow(deviceB)
    await syncNow(deviceA)

    // Not just "a session arrived": what the user wrote on B is what A shows.
    await openSession(deviceA, '1 exercises')
    await expect(entryCard(deviceA, 'Overhead press')).toContainText('40 kg × 6 reps')

    await deleteNewestWorkout(deviceB)
    await syncNow(deviceB)
    await syncNow(deviceA)

    await openHome(deviceA)
    await expect(sessionRow(deviceA)).toHaveCount(0)
    // A deletion travels as a tombstone, and it has to still be one here: a
    // device that dropped the row instead would have nothing to push, and the
    // session would come back the next time some other device re-uploaded it.
    const row = (await storedSessions(deviceA)).find(session => session.id === recorded!.id)
    expect(row, `session ${recorded!.id} should have arrived as a row`).toBeDefined()
    expect(row!.deleted).toBe(true)
  })

  test('makes both devices agree when each edits the same session', async ({ browser }) => {
    const deviceA = await openDevice(browser)
    const deviceB = await openDevice(browser)

    await logIn(deviceA, account!)
    await emptyTheAccount(deviceA)
    await recordWorkout(deviceA, 'Squat', { weight: 60, reps: 5 })
    await syncNow(deviceA)

    await logIn(deviceB, account!)
    await openHome(deviceB)
    await expect(sessionRow(deviceB)).toHaveCount(1)

    // The conflict: both edit the copy they have, neither having seen the
    // other's edit. B's lands second, so `nextUpdatedAt` gives it the higher
    // stamp and `compareSessions` says it wins — on both devices, which is the
    // whole point of the two of them computing that order the same way.
    await openSession(deviceA, '1 exercises')
    await openEntry(deviceA, 'Squat')
    await fillWorkoutValues(deviceA, { weight: 65 })
    await saveEntry(deviceA)
    await expect(entryCard(deviceA, 'Squat')).toContainText('65 kg')

    await openSession(deviceB, '1 exercises')
    // Still on the copy it pulled at login — B has had no reason to sync since,
    // so this is an edit made in ignorance of A's and not one on top of it.
    await expect(entryCard(deviceB, 'Squat')).toContainText('60 kg')
    await openEntry(deviceB, 'Squat')
    await fillWorkoutValues(deviceB, { weight: 70 })
    await saveEntry(deviceB)

    // A pushes its version, B pulls it and keeps its own — which leaves B
    // dirty, so it pushes over the top — and A pulls that. The fourth round is
    // there because a mutation also schedules a sync of its own: one of the
    // clicks above can find that run already in flight, having started before
    // the other device pushed, and so do a round's work over stale data.
    await syncNow(deviceA)
    await syncNow(deviceB)
    await syncNow(deviceA)
    await syncNow(deviceB)

    await openSession(deviceA, '1 exercises')
    await expect(entryCard(deviceA, 'Squat')).toContainText('70 kg')
    await openSession(deviceB, '1 exercises')
    await expect(entryCard(deviceB, 'Squat')).toContainText('70 kg')

    // Byte for byte the same session, stamp included. Two devices showing the
    // same weight is not convergence: one of them could still be holding a
    // copy it thinks is newer, and would push it back the moment anything else
    // changed.
    expect(await visibleSessions(deviceA)).toEqual(await visibleSessions(deviceB))
  })

  test('pushes a workout recorded offline once the connection is back', async ({ browser }) => {
    const deviceA = await openDevice(browser)
    const deviceB = await openDevice(browser)

    await logIn(deviceA, account!)
    await emptyTheAccount(deviceA)
    await logIn(deviceB, account!)

    await deviceA.context().setOffline(true)
    await recordWorkout(deviceA, 'Pull-up', { reps: 8 })
    const [recorded] = await visibleSessions(deviceA)

    // Asking for a sync while offline says so rather than failing quietly, and
    // `syncNow` bails before the network: there is no error on the card to
    // clear up afterwards.
    await syncNow(deviceA)
    await expect(snackbar(deviceA)).toHaveText('You are offline')

    // Nothing reached the account, so what B sees below is the flush and not
    // something that had already been pushed before the line above.
    await syncNow(deviceB)
    expect(await visibleSessions(deviceB)).toHaveLength(0)

    // Reloaded while still offline, and this is what makes the rest of the
    // test about the `online` listener rather than about luck: recording
    // schedules a debounced sync, and that timer can still be pending when the
    // connection comes back — in which case it fires, pushes, and the
    // assertion below passes with the listener deleted. The reload drops it.
    // What the fresh page starts on its own is the sync in `init`, and that
    // one bails on `navigator.onLine` like the button did.
    await deviceA.reload()
    await openHome(deviceA)
    // Offline and freshly started, the workout is still there: it was written
    // to the device before anything went near the network.
    await expect(sessionRow(deviceA)).toHaveCount(1)

    await deviceA.context().setOffline(false)

    // Deliberately without touching *Sync now* on A: the `online` listener in
    // `stores/sync.ts` is the thing under test, and pressing the button would
    // pass whether or not it exists. B is only the observer — it has to keep
    // asking, because A's flush happens on its own schedule.
    await expect.poll(
      async () => {
        await syncNow(deviceB)
        return (await visibleSessions(deviceB)).map(session => session.id)
      },
      { message: 'device A should push what it recorded offline', timeout: 60_000 },
    ).toEqual([recorded!.id])

    await openSession(deviceB, '1 exercises')
    await expect(entryCard(deviceB, 'Pull-up')).toContainText('8 reps')
  })
})
