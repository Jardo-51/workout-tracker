import { expect, test } from '@playwright/test'
import { SYNC_META_PREFIX } from '../src/services/db.constants'
import {
  addExercise,
  appRoot,
  darkModeSwitch,
  emptyTheAccount,
  entryCard,
  etesyncCard,
  logIn,
  loginError,
  logOut,
  openApp,
  openHome,
  openSession,
  openSettings,
  recordWorkout,
  sessionRow,
  setDarkMode,
  setDefaultWeightUnit,
  startSession,
  storedKeys,
  storedSyncState,
  submitLogin,
  syncNow,
  themeColor,
  weightUnitButton,
} from './support/app'
import { syncedDescribe } from './support/etebase'

/**
 * The Settings cards other than Backup, which `backup.spec.ts` already covers:
 * the two preferences, and the account the sync card logs in and out of.
 *
 * Both preferences live in localStorage rather than in the database, so what
 * makes them worth a browser test is the reload: the store reads them back on
 * start, and that is what the reloads below are for.
 *
 * Deliberately *not* covered: the `defaultTheme` line in `plugins/vuetify.ts`,
 * which exists so a dark-mode user gets no white flash before the app mounts.
 * Every assertion here runs long after mount, by which point App.vue's
 * `immediate` watcher has set the theme itself — delete that line and this
 * file stays green. Proving it would mean asserting on the first paint, which
 * is not worth the flake; anyone touching it should know a green run here says
 * nothing about it.
 */
test.describe('settings', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('turns dark mode on, and comes back dark after a reload', async ({ page }) => {
    await openSettings(page)
    await expect(appRoot(page)).toHaveClass(/v-theme--light/)
    await expect(darkModeSwitch(page)).not.toBeChecked()
    const lightColor = await themeColor(page)

    await setDarkMode(page, true)
    // The browser's own chrome follows the theme, which is the reason App.vue
    // touches this tag at all: index.html hard-codes a blue that reads wrong
    // against a dark app.
    const darkColor = await themeColor(page)
    expect(darkColor).not.toBe(lightColor)

    await page.reload()
    await openSettings(page)
    await expect(appRoot(page)).toHaveClass(/v-theme--dark/)
    await expect(darkModeSwitch(page)).toBeChecked()
    expect(await themeColor(page)).toBe(darkColor)

    // And the switch goes back the other way.
    await setDarkMode(page, false)
    expect(await themeColor(page)).toBe(lightColor)
  })

  test('changes the unit new entries start in, and keeps it across a reload', async ({ page }) => {
    await openSettings(page)
    await expect(weightUnitButton(page, 'kg')).toHaveClass(/v-btn--active/)

    await setDefaultWeightUnit(page, 'lbs')
    await page.reload()
    await openSettings(page)
    await expect(weightUnitButton(page, 'lbs')).toHaveClass(/v-btn--active/)
    await expect(weightUnitButton(page, 'kg')).not.toHaveClass(/v-btn--active/)

    // The point of the setting: an entry that is not told otherwise takes it.
    await startSession(page)
    await addExercise(page, 'Squat', { weight: 60 })
    await expect(entryCard(page, 'Squat')).toContainText('60 lbs')
  })

  test('says why a login to a server that is not there failed', async ({ page }) => {
    const keysBeforeLogin = await storedKeys(page)

    // A closed port on loopback, so the failure is an immediate refusal rather
    // than a DNS lookup that a machine with a hijacking resolver might answer.
    await submitLogin(page, {
      url: 'http://127.0.0.1:59999/',
      username: 'gymrat',
      password: 'correct-horse-battery',
    })

    // Not just "an error is showing": the alert only exists when there is a
    // message in it, so its visibility says nothing about the message being
    // any use. `doLogin` stringifies whatever is thrown, so "[object Object]"
    // is a real possible outcome — the text has to name the failure.
    await expect(loginError(page)).toHaveText(/network|connect|fetch/i, { timeout: 60_000 })

    // Still logged out: the card shows the form, not an account, and nothing
    // was saved that a reload could bring back as a half-configured sync.
    const submit = page.getByRole('button', { name: 'Log in & sync' })
    await expect(submit).toBeVisible()
    await expect(submit).not.toHaveClass(/v-btn--loading/)
    await expect(etesyncCard(page).getByRole('button', { name: 'Sync now' })).toBeHidden()
    expect(await storedKeys(page)).toEqual(keysBeforeLogin)

    // And the app is not stuck on the failure — it is still a workout tracker.
    await recordWorkout(page, 'Squat')
    await expect(sessionRow(page)).toHaveCount(1)
  })
})

/**
 * The account itself, which needs a real server: a rejected password and a
 * logout are both answers only the server can give. See e2e/README.md.
 */
syncedDescribe('settings, with sync', account => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('refuses a wrong password, and takes the right one afterwards', async ({ page }) => {
    const keysBeforeLogin = await storedKeys(page)
    await submitLogin(page, { ...account, password: `${account.password}-wrong` })

    // The server's own answer, not just any error: a test that accepted
    // "Network request failed" here would pass against a login that never
    // reached the server at all.
    await expect(loginError(page)).toHaveText(/password/i, { timeout: 60_000 })
    await expect(page.getByRole('button', { name: 'Log in & sync' })).toBeVisible()
    expect(await storedKeys(page)).toEqual(keysBeforeLogin)

    // The form is left usable, not wedged in its error state.
    await logIn(page, account)
    expect(await storedKeys(page)).toContain('etesync.session')
  })

  test('logs out, keeping the workouts and dropping the sync bookkeeping', async ({ page }) => {
    const keysBeforeLogin = await storedKeys(page)
    await logIn(page, account)
    // The account outlives the run, so start from empty — otherwise the row
    // count below is whatever a previous test happened to leave up there.
    await emptyTheAccount(page)

    await recordWorkout(page, 'Squat')
    await syncNow(page)

    // There is bookkeeping to lose: an etebase item cache per synced session,
    // and the sync service's own keys in the shared `meta` store. Counted as
    // "some" rather than "one" — the login pulls down every tombstone the
    // account has ever been left with, and each of those is a row too.
    const synced = await storedSyncState(page)
    expect(synced.syncMeta.length).toBeGreaterThan(0)
    expect(synced.meta.filter(key => key.startsWith(SYNC_META_PREFIX)).length).toBeGreaterThan(0)
    expect(await storedKeys(page)).toContain('etesync.session')

    await logOut(page)

    await expect(etesyncCard(page).getByRole('button', { name: 'Log in & sync' })).toBeVisible()
    // Not "no etesync keys": localStorage is back to what it was before the
    // login, whatever the app chooses to call the things it saves.
    expect(await storedKeys(page)).toEqual(keysBeforeLogin)

    // What is left in IndexedDB is what a later login would push at whatever
    // account it is given, so none of it may survive: a stale item cache
    // belongs to a collection the next account does not have.
    const afterLogout = await storedSyncState(page)
    expect(afterLogout.syncMeta).toEqual([])
    expect(afterLogout.meta.filter(key => key.startsWith(SYNC_META_PREFIX))).toEqual([])

    // The workouts are the one thing a logout is not allowed to take —
    // "data stays on this device" is what the app promises as it does it.
    await openHome(page)
    await expect(sessionRow(page)).toHaveCount(1)
    await openSession(page, '1 exercises')
    await expect(entryCard(page, 'Squat')).toBeVisible()
  })
})
