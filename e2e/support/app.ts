import type { Session, Tempo, WeightUnit } from '../../src/types/workout'
import fs from 'node:fs/promises'
import { type Browser, expect, type Locator, type Page } from '@playwright/test'
import { SYNC_LOCK } from '../../src/services/broadcast'

/**
 * Driving the app the way a user does: the bottom nav, the buttons, the
 * dialogs. Four helpers reach past that, all for the same reason — the thing
 * those tests are about has no form on screen: {@link storedSessions}, because
 * the difference between a tombstone and a removed row is invisible;
 * {@link storedKeys} and {@link storedSyncState}, because what a logout leaves
 * behind is what a later login would push at whatever account it is given; and
 * {@link holdSyncLock}, because "another tab is already syncing" is a state
 * nothing on screen shows and nothing in a test can time.
 *
 * A fifth wants that same argument, not just convenience.
 */

/** Shape of an export file, as `services/backup.ts` writes it. */
export interface Backup {
  app: string
  fileVersion: number
  exportedAt: string
  sessions: Session[]
}

/**
 * One device: its own browser context, so its own IndexedDB and its own saved
 * Etebase session. Two of these is what makes a test about syncing between
 * devices rather than between two tabs of one.
 *
 * Downloads are accepted because a device may be asked to export a backup;
 * nothing else here needs it.
 */
export async function openDevice (browser: Browser): Promise<Page> {
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  await openApp(page)
  return page
}

/**
 * A second tab of the same device: another page in the same context, so the
 * same IndexedDB, the same localStorage and the same `BroadcastChannel`.
 * {@link openDevice} is the other half of the pair — two of those are two
 * devices, two of these are two tabs, and only the second kind can hear a
 * broadcast.
 *
 * Comes back only once this tab is *listening*, which is the one property it
 * exists to provide: `stores/sessions.ts` registers `onSessionChanged` and
 * `onDataReplaced` at the end of its load, so until that load resolves the
 * channel has not even been constructed and a message sent at this tab is
 * dropped for good — there is no replay.
 *
 * {@link loadedHome} is what says the load resolved. Home's start button is
 * rendered before it and so cannot: a wait on that alone would hand back a tab
 * that hears nothing, and the caller would find out one flaky run in ten.
 */
export async function openTab (page: Page): Promise<Page> {
  const tab = await page.context().newPage()
  await tab.goto('/')
  await expect(loadedHome(tab)).toBeVisible()
  return tab
}

/**
 * Whichever part of Home only appears once the sessions store has finished
 * reading IndexedDB — the resume card, a row in *Previous sessions*, or the
 * *No workouts yet* placeholder, which `HomePage.vue` holds back until then for
 * the same reason. One of the three is showing in every state the app can be
 * in, and none of them before the load.
 *
 * `first()` because two of them can be up at once — a session under way and
 * earlier ones below it — and a union matching twice is a strict-mode failure
 * rather than the wait it was asked for.
 */
function loadedHome (page: Page) {
  return resumeCard(page)
    .or(sessionRow(page))
    .or(page.getByText('No workouts yet'))
    .first()
}

export async function openApp (page: Page) {
  await page.goto('/')
  // Specifically the start button, not `openHome`'s either/or: a test opens the
  // app on an empty device, where a session cannot already be under way.
  await expect(startButton(page)).toBeVisible()
}

/**
 * Snackbars sit over the bottom of the screen, where the nav and the session
 * action bar are, and swallow the clicks aimed at them. Resolves immediately
 * when none is showing.
 *
 * Dismissed rather than waited out where that is possible: the message would
 * otherwise stay up for its full timeout and a suite that finishes a session in
 * most of its tests spends that idling. The close button is the same one a user
 * has.
 *
 * That click is best-effort — bounded, and its failure swallowed — because the
 * message can expire under it: finding the button says nothing about it still
 * being there when the click lands, and an unbounded click left waiting for a
 * button that has gone holds on until the test itself times out. Whatever the
 * click does not manage, the wait below covers.
 *
 * The `isVisible()` guard in front of it is what keeps that bound off the
 * common path. Most calls here find no snackbar at all — the helpers call
 * `settle()` before navigating whether or not anything is showing — and going
 * straight to the click makes every one of those pay the timeout in full,
 * which across a run costs more than the waiting this function exists to skip.
 *
 * A message offering an undo deliberately has no close button, so that one is
 * still waited out — and its 6 s window is why the wait here is longer than
 * that, rather than the 5 s it used to be, which could expire first and hand
 * back a screen still covered by the snackbar.
 */
export async function settle (page: Page) {
  const snack = page.locator('.v-snackbar--active').first()
  const close = snack.getByRole('button', { name: 'Close' })
  if (await close.isVisible()) {
    await close.click({ timeout: 1000 }).catch(() => {})
  }
  await snack.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
}

async function navigate (page: Page, to: 'Home' | 'Settings') {
  await settle(page)
  await page.getByRole('link', { name: to }).click()
}

/**
 * Home, waiting for whichever of its two shapes applies: the start button, or
 * the resume card that replaces it while a session is still open.
 *
 * The nav click is skipped when Home is already showing, because the only
 * thing it would buy is `settle()` — and after a finished session that means
 * idling out the *Workout finished* snackbar for no reason.
 */
export async function openHome (page: Page) {
  if (new URL(page.url()).pathname !== '/') {
    await navigate(page, 'Home')
  }
  await expect(startButton(page).or(resumeCard(page))).toBeVisible()
}

export function startButton (page: Page) {
  return page.getByRole('button', { name: 'Start workout' })
}

export function resumeCard (page: Page) {
  return page.locator('.v-card').filter({ hasText: 'Resume workout' })
}

/**
 * A row in Home's *Previous sessions* list. Scoped to that card, because
 * `v-list-item` is also what a combobox menu and the history dialog are built
 * out of — page-wide it would count those too.
 */
export function sessionRow (page: Page, text?: string | RegExp) {
  const rows = page.locator('.past-sessions .v-list-item')
  return text === undefined ? rows : rows.filter({ hasText: text })
}

export async function openSettings (page: Page) {
  await navigate(page, 'Settings')
  await expect(page.getByText('Backup', { exact: true })).toBeVisible()
}

/**
 * One entry card in the open session. Scoped to the card rather than matched on
 * text, because while the workout dialog is open its combobox holds the same
 * exercise name and a plain text match would not say which of the two it means.
 * (A *closed* dialog is not a second match: Vuetify 4 unmounts it outright.)
 */
export function entryCard (page: Page, exercise: string) {
  return page.locator('.v-card.mb-2').filter({ hasText: exercise })
}

/**
 * Every entry of the open session, workouts and breaks alike, in the order the
 * session shows them. Both kinds are direct children of the page and nothing
 * else there carries `mb-2`, which is what makes one locator cover the two.
 */
export function entryList (page: Page) {
  return page.locator('.session-page > .mb-2')
}

/** One break in the open session, named the way it reads: `1 min 30 s`. */
export function breakRow (page: Page, duration: string) {
  return page.getByRole('button', { name: `Break — ${duration}` })
}

/**
 * The Add/Edit exercise dialog. Scoped by the combobox only it has, because
 * its own *Delete this entry?* confirmation is a second dialog on top of it.
 */
export function workoutDialog (page: Page) {
  return page.getByRole('dialog').filter({
    has: page.getByRole('combobox', { name: 'Exercise' }),
  })
}

/**
 * The exercise-history dialog for one exercise, picked out by the toolbar
 * title only it has — the exercise's own name, where the workout dialog it
 * opens over says *Add exercise* or *Edit exercise*.
 */
export function historyDialog (page: Page, exercise: string) {
  return page.getByRole('dialog').filter({
    has: page.locator('.v-toolbar-title', { hasText: exercise }),
  })
}

/** The history button in the workout dialog's toolbar, beside the close one. */
export function historyButton (page: Page) {
  return workoutDialog(page).locator('.v-toolbar').getByRole('button').last()
}

export function breakSheet (page: Page) {
  return page.locator('.v-bottom-sheet')
}

/** The card of a confirmation dialog, picked out by the question it asks. */
export function confirmCard (page: Page, question: string) {
  return page.locator('.v-card').filter({ hasText: question })
}

/**
 * One `StepperField` row in the workout dialog: the field, and the − and +
 * buttons either side of it, which carry icons and so have no name to match on.
 */
export function stepper (page: Page, label: string) {
  const rows = workoutDialog(page).locator('.d-flex.align-center.ga-2.mb-3')
  const row = rows.filter({ has: page.getByLabel(label, { exact: true }) })
  return {
    field: row.getByRole('textbox'),
    minus: row.getByRole('button').first(),
    plus: row.getByRole('button').last(),
  }
}

/** One of `TempoInput`'s four columns: down, hold, up, hold. */
function tempoColumn (page: Page, index: number) {
  const column = workoutDialog(page).locator('.v-col--cols-3').nth(index)
  return {
    value: column.locator('.text-h5'),
    plus: column.getByRole('button').first(),
    minus: column.getByRole('button').last(),
  }
}

/** What the workout dialog can be given. `tempo: null` means without tempo. */
export interface WorkoutValues {
  weight?: number
  unit?: WeightUnit
  reps?: number
  sets?: number
  tempo?: Tempo | null
}

/** Walks each tempo column to its wanted value; +/− is the only way to set it. */
async function setTempo (page: Page, tempo: Tempo | null) {
  const withoutTempo = workoutDialog(page).getByLabel('Without tempo')
  await withoutTempo.setChecked(tempo === null)
  if (tempo === null) {
    return
  }
  for (const [index, wanted] of tempo.entries()) {
    const column = tempoColumn(page, index)
    let current = Number(await column.value.textContent())
    while (current !== wanted) {
      const up = current < wanted
      await (up ? column.plus : column.minus).click()
      current += up ? 1 : -1
      await expect(column.value).toHaveText(String(current))
    }
  }
}

/**
 * Fills the open workout dialog. The name goes in first on purpose: picking an
 * exercise that has been done before prefills the values from last time, so
 * setting them the other way round would have that land on top of them.
 */
export async function fillWorkoutValues (
  page: Page,
  values: WorkoutValues & { name?: string },
) {
  const dialog = workoutDialog(page)
  if (values.name !== undefined) {
    await dialog.getByRole('combobox', { name: 'Exercise' }).fill(values.name)
  }
  if (values.unit !== undefined) {
    const chip = dialog.locator('.v-chip')
    if (await chip.textContent() !== values.unit) {
      await chip.click()
    }
    await expect(chip).toHaveText(values.unit)
  }
  for (const [label, value] of [
    ['Weight', values.weight],
    ['Reps', values.reps],
    ['Sets', values.sets],
  ] as const) {
    if (value !== undefined) {
      await stepper(page, label).field.fill(String(value))
    }
  }
  if (values.tempo !== undefined) {
    await setTempo(page, values.tempo)
  }
}

/** Opens the Add exercise dialog from the action bar. */
export async function openAddExercise (page: Page) {
  await settle(page)
  await page.getByRole('button', { name: 'Exercise', exact: true }).click()
  const dialog = workoutDialog(page)
  await expect(dialog.getByText('Add exercise')).toBeVisible()
  return dialog
}

/** Adds one exercise to the open session. */
export async function addExercise (page: Page, name: string, values: WorkoutValues = {}) {
  const dialog = await openAddExercise(page)
  await fillWorkoutValues(page, { name, ...values })
  await dialog.getByRole('button', { name: 'Add' }).click()
  await expect(dialog).toBeHidden()
  await expect(entryCard(page, name)).toBeVisible()
}

/** Opens an entry's card for editing and hands back the dialog. */
export async function openEntry (page: Page, name: string) {
  await settle(page)
  await entryCard(page, name).click()
  const dialog = workoutDialog(page)
  await expect(dialog.getByText('Edit exercise')).toBeVisible()
  return dialog
}

export async function saveEntry (page: Page) {
  const dialog = workoutDialog(page)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
}

/** Opens the break sheet from the action bar. */
async function openBreakSheet (page: Page) {
  await settle(page)
  await page.getByRole('button', { name: 'Break', exact: true }).click()
  const sheet = breakSheet(page)
  await expect(sheet).toBeVisible()
  return sheet
}

/** Adds a break from one of the sheet's presets. */
export async function addBreakPreset (page: Page, seconds: 60 | 90 | 120) {
  const sheet = await openBreakSheet(page)
  await sheet.getByRole('button', { name: `${seconds} s` }).click()
  await expect(sheet).toBeHidden()
}

/** Adds a break of any length, typed into the sheet's own field. */
export async function addCustomBreak (page: Page, seconds: number) {
  const sheet = await openBreakSheet(page)
  await sheet.getByLabel('Custom duration').fill(String(seconds))
  await sheet.getByRole('button', { name: 'Add' }).click()
  await expect(sheet).toBeHidden()
}

/** The session note, a button showing the note until it is clicked to edit it. */
export function noteButton (page: Page) {
  return page.locator('.session-page > .mb-4').getByRole('button')
}

/** Writes the session note and blurs the field, which is what saves it. */
export async function setSessionNote (page: Page, note: string) {
  await noteButton(page).click()
  await page.getByLabel('Note', { exact: true }).fill(note)
  // Saved on blur, so the focus has to go somewhere — the session's own header.
  await page.locator('.session-page .text-h6').first().click()
  await expect(noteButton(page)).toHaveText(note)
}

/** Starts a session from Home and lands on its page. */
export async function startSession (page: Page) {
  await openHome(page)
  await startButton(page).click()
  await page.waitForURL(/\/session\//)
}

/** Finishes the open session. The app routes back to Home on its own. */
export async function finishSession (page: Page) {
  await settle(page)
  await page.getByRole('button', { name: 'Finish' }).click()
  await page.waitForURL(/\/$/)
  await openHome(page)
}

/** Runs a whole workout: start, one exercise, finish. Ends up back on Home. */
export async function recordWorkout (page: Page, exercise: string, values: WorkoutValues = {}) {
  await startSession(page)
  await addExercise(page, exercise, values)
  await finishSession(page)
}

/** Opens a session from Home's list. */
export async function openSession (page: Page, text: string | RegExp) {
  await openHome(page)
  await sessionRow(page, text).click()
  await page.waitForURL(/\/session\//)
}

/** Sets the unit new entries start out in, from the Units card in Settings. */
export async function setDefaultWeightUnit (page: Page, unit: WeightUnit) {
  await openSettings(page)
  await settle(page)
  await weightUnitButton(page, unit).click()
  await expect(weightUnitButton(page, unit)).toHaveClass(/v-btn--active/)
}

/** One side of the Units card's toggle; `v-btn--active` marks the chosen one. */
export function weightUnitButton (page: Page, unit: WeightUnit) {
  return page.getByRole('button', { name: unit, exact: true })
}

/** The Appearance card's switch. Its own label is what the user reads. */
export function darkModeSwitch (page: Page) {
  return page.getByLabel('Dark mode')
}

/**
 * The element Vuetify hangs the active theme off, as `v-theme--dark` or
 * `v-theme--light` — the one place the choice is observable from outside.
 */
export function appRoot (page: Page) {
  return page.locator('.v-application')
}

/** The colour the browser paints its own chrome with, kept in step by App.vue. */
export function themeColor (page: Page): Promise<string | null> {
  return page.locator('meta[name="theme-color"]').getAttribute('content')
}

/** Turns dark mode on or off from the Appearance card. */
export async function setDarkMode (page: Page, dark: boolean) {
  await openSettings(page)
  await settle(page)
  await darkModeSwitch(page).setChecked(dark)
  await expect(appRoot(page)).toHaveClass(dark ? /v-theme--dark/ : /v-theme--light/)
}

/** Deletes the workout at the top of the Home list, confirming the dialog. */
export async function deleteNewestWorkout (page: Page) {
  await openHome(page)
  await sessionRow(page).first().getByRole('button').click()
  const confirm = confirmCard(page, 'Delete session?')
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(confirm).toBeHidden()
}

/**
 * Empties the named object stores of the app's database, in one transaction —
 * either their rows or just their keys, one array per store in the order asked.
 *
 * What to read is passed as data rather than as a callback because
 * `page.evaluate` ships the function to the browser as source: it closes over
 * nothing, so anything a caller wanted to reuse — the request-to-promise
 * wrapping, the open, the `close()` — would have to be written out again inside
 * every caller's own callback.
 */
function readDb (
  page: Page,
  stores: string[],
  read: 'getAll' | 'getAllKeys',
): Promise<unknown[][]> {
  return page.evaluate(async ({ read, stores }) => {
    const settled = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.addEventListener('success', () => resolve(request.result))
      request.addEventListener('error', () => reject(request.error))
    })
    const db = await settled(indexedDB.open('workout-tracker'))
    try {
      const tx = db.transaction(stores)
      return await Promise.all(stores.map(async name => {
        const store = tx.objectStore(name)
        // Branched rather than picking the method first: the two requests
        // resolve to different types, and a union of them is not an
        // `IDBRequest` of anything.
        return read === 'getAll' ? await settled(store.getAll()) : await settled(store.getAllKeys())
      }))
    } finally {
      db.close()
    }
  }, { read, stores })
}

/** Every row in IndexedDB, tombstones included. */
export async function storedSessions (page: Page): Promise<Session[]> {
  const [sessions] = await readDb(page, ['sessions'], 'getAll')
  return sessions as Session[]
}

export async function visibleSessions (page: Page): Promise<Session[]> {
  return (await storedSessions(page)).filter(session => !session.deleted)
}

/** The text of whatever the app is currently telling the user. */
export function snackbar (page: Page) {
  return page.locator('.v-snackbar__content')
}

/**
 * Exports from the Backup card and saves the file, returning it parsed
 * alongside the path and the name the browser was given.
 */
export async function exportBackup (page: Page, saveAs: string) {
  await openSettings(page)
  await settle(page)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export' }).click(),
  ])
  await download.saveAs(saveAs)
  const backup = JSON.parse(await fs.readFile(saveAs, 'utf8')) as Backup
  return { backup, path: saveAs, suggestedFilename: download.suggestedFilename() }
}

/** Picks a file in the Backup card and confirms the import dialog. */
export async function importBackup (page: Page, path: string) {
  await openSettings(page)
  await settle(page)
  await page.locator('input[type=file]').setInputFiles(path)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Import backup?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** Picks a file and returns the dialog, for tests that assert on it first. */
export async function chooseBackupFile (page: Page, path: string) {
  await openSettings(page)
  await settle(page)
  await page.locator('input[type=file]').setInputFiles(path)
}

/**
 * Opens the clear confirmation and hands back the dialog, so a test can assert
 * on which of the two warnings it got — they differ by whether sync is on, and
 * so does what the clear then does.
 */
export async function openClearDialog (page: Page) {
  await openSettings(page)
  await settle(page)
  await page.getByRole('button', { name: 'Clear all workouts' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Clear all workouts?')).toBeVisible()
  return dialog
}

export async function clearAllWorkouts (page: Page) {
  const dialog = await openClearDialog(page)
  await confirmClear(dialog)
}

export async function confirmClear (dialog: Locator) {
  await dialog.getByRole('button', { name: 'Delete everything' }).click()
  await expect(dialog).toBeHidden()
}

/**
 * The Etesync sync card, which is the login form or the account, never both.
 *
 * Matched on its own title rather than on the text anywhere in the card: the
 * *Clear all workouts?* dialog names the card while sync is on, so a plain
 * text match resolves to two cards for as long as that dialog is mounted —
 * which outlasts `confirmClear`, whose `toBeHidden()` is satisfied by the
 * leave transition having started.
 */
export function etesyncCard (page: Page) {
  return page.locator('.v-card').filter({
    has: page.locator('.v-card-title', { hasText: 'Etesync sync' }),
  })
}

/**
 * Whatever the login form is complaining about, if anything.
 *
 * Inside the form specifically. The card holds a second alert when logged in —
 * the sync store's own last error — and while the two can never be up at once,
 * an unscoped `.v-alert` would let a test that thinks it is reading a rejected
 * login quietly assert on a failed sync instead.
 */
export function loginError (page: Page) {
  return etesyncCard(page).locator('form .v-alert')
}

/**
 * Fills the login form and submits it, without waiting for an outcome — which
 * is the point: the tests that want a *failed* login have no "Syncing as" to
 * wait for, only the form's own error.
 */
export async function submitLogin (
  page: Page,
  account: { url: string, username: string, password: string },
) {
  await openSettings(page)
  await page.getByLabel('Server URL').fill(account.url)
  await page.getByLabel('Username').fill(account.username)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Log in & sync' }).click()
}

export async function logIn (
  page: Page,
  account: { url: string, username: string, password: string },
) {
  await submitLogin(page, account)
  await expect(page.getByText(`Syncing as ${account.username}`)).toBeVisible({ timeout: 60_000 })
  // The login runs a first sync; let it finish before anything else starts one.
  await expect(page.getByRole('button', { name: 'Sync now' })).not.toHaveClass(
    /v-btn--loading/,
    { timeout: 60_000 },
  )
}

/** How many swallowed presses of *Sync now* are worth trying again. */
const SYNC_ATTEMPTS = 5

/**
 * Presses *Sync now* and comes back only once a sync has really run.
 *
 * The press can do nothing at all. `useSyncStore.syncNow()` returns straight
 * away when a run is already in flight — a mutation arms a 4 s debounce, so one
 * often is — and only re-arms that timer. The loading state on the button
 * belongs to the run already going and clears when *it* ends, so waiting on the
 * button alone can hand back a device that has pushed nothing this test asked
 * of it, leaving whatever is asserted next to read stale data.
 *
 * `EtesyncSettings.doSync` says *Synced* only when the run was its own, which
 * makes that message the acknowledgement to wait for, and its absence the
 * signal to press again. *You are offline* is the other answer the button
 * gives, and it is a final one: the tests that ask for a sync while offline
 * want exactly that message and no retrying.
 *
 * Anything else — no message at all — means the run failed, and the sync card's
 * own error alert says why; the presses stop after {@link SYNC_ATTEMPTS} rather
 * than spending the test's whole budget on a server that is not answering.
 */
export async function syncNow (page: Page) {
  const answer = snackbar(page).filter({ hasText: /Synced|You are offline/ })
  for (let attempt = 0; attempt < SYNC_ATTEMPTS; attempt++) {
    await pressSyncNow(page)
    const answered = await answer.waitFor({ timeout: 5000 }).then(() => true, () => false)
    if (answered) {
      return
    }
  }
  throw new Error(
    `Sync now was pressed ${SYNC_ATTEMPTS} times and no sync ran — `
    + 'the Etesync card\'s error alert says why.',
  )
}

/**
 * One press of *Sync now*, waiting only for the button to come back — not for
 * the app to say a run happened.
 *
 * {@link syncNow} is what a test that needs a sync to have run wants; this is
 * for the one test that is about a press being *refused*, while another tab
 * holds the sync lock. There the acknowledgement never comes, so pressing
 * through that helper would spend five attempts and then throw.
 */
export async function pressSyncNow (page: Page) {
  await openSettings(page)
  const button = page.getByRole('button', { name: 'Sync now' })
  await settle(page)
  // Pressing into a run that is already going is the swallowed press itself.
  await expect(button).not.toHaveClass(/v-btn--loading/, { timeout: 60_000 })
  await button.click()
  await expect(button).not.toHaveClass(/v-btn--loading/, { timeout: 60_000 })
}

/** Where {@link holdSyncLock} parks the callback that ends the lock it took. */
type LockHolder = Window & { releaseSyncLock?: () => void }

/**
 * Takes the Web Lock a sync run holds, from the page's own JS — which is
 * exactly what a tab in the middle of a sync is doing.
 *
 * The fourth reach past the UI, and for the same reason as the other three:
 * "another tab is already syncing" is a state with no form on screen at all.
 * Nor can a real one be used — a run against a local server is over in
 * milliseconds, so there is no window for a second tab to press into, and a
 * test that tried would be a coin toss. Held here, the state stays put for as
 * long as the assertions need it.
 *
 * Resolves once the lock is actually held, which means waiting out a sync that
 * is already running; the {@link SYNC_LOCK} name is imported so the app and
 * this cannot drift apart.
 */
export async function holdSyncLock (page: Page) {
  await page.evaluate(
    name => new Promise<void>(granted => {
      void navigator.locks.request(name, () => new Promise<void>(release => {
        const holder = window as LockHolder
        holder.releaseSyncLock = release
        granted()
      }))
    }),
    SYNC_LOCK,
  )
}

/** Lets go of the lock {@link holdSyncLock} took. */
export async function releaseSyncLock (page: Page) {
  await page.evaluate(() => {
    const holder = window as LockHolder
    holder.releaseSyncLock?.()
  })
}

/**
 * Leaves the logged-in account with no workouts in it, whatever a previous run
 * left. Clearing is the app's own way of emptying it, which is what makes a
 * run against a long-lived test account repeatable.
 */
export async function emptyTheAccount (page: Page) {
  await syncNow(page)
  if ((await visibleSessions(page)).length > 0) {
    await clearAllWorkouts(page)
    await syncNow(page)
  }
}

/**
 * Logs out and waits for the store to have finished doing it.
 *
 * The message is the wait, not the form coming back: `logout()` drops the
 * saved session first — which is what re-renders the card — and only then
 * waits out a sync that is already running, clears the sync state out of
 * IndexedDB and tells the server. The snackbar is shown after all of that, so
 * it is the one point from which the leftovers can be read without racing the
 * clearing of them.
 */
export async function logOut (page: Page) {
  await openSettings(page)
  await settle(page)
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(snackbar(page)).toHaveText(
    'Sync disabled — data stays on this device',
    { timeout: 60_000 },
  )
}

/**
 * Every key in localStorage, sorted — which is where the account lives.
 *
 * Deliberately unfiltered. What a refused login, or a logout, must leave
 * behind is *nothing that was not already there*, and a helper that filtered
 * to `etesync.*` could only ever say "nothing starts with the prefix this test
 * picked" — a statement that stays true, and green, if the app renames its
 * keys. Comparing the whole of localStorage against a snapshot taken before
 * the login says what is meant without knowing any key names at all.
 */
export function storedKeys (page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(localStorage).toSorted())
}

/**
 * The sync bookkeeping in IndexedDB — the per-session etebase caches, and the
 * sync service's own keys in the shared `meta` store. What a logout leaves
 * behind here is what a later login would push at the account.
 */
export async function storedSyncState (page: Page): Promise<{ syncMeta: string[], meta: string[] }> {
  const [syncMeta, meta] = await readDb(page, ['syncMeta', 'meta'], 'getAllKeys')
  return {
    syncMeta: syncMeta.map(String).toSorted(),
    meta: meta.map(String).toSorted(),
  }
}
