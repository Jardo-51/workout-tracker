import type { Session, Tempo, WeightUnit } from '../../src/types/workout'
import fs from 'node:fs/promises'
import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Driving the app the way a user does: the bottom nav, the buttons, the
 * dialogs. Nothing here reaches into the app's internals except
 * {@link storedSessions}, which reads IndexedDB because "what is actually on
 * the device" is the thing several of these tests are about — the difference
 * between a tombstone and a removed row is invisible on screen.
 */

/** Shape of an export file, as `services/backup.ts` writes it. */
export interface Backup {
  app: string
  fileVersion: number
  exportedAt: string
  sessions: Session[]
}

export async function openApp (page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible()
}

/**
 * Snackbars sit over the bottom of the screen, where the nav is, and swallow
 * the clicks aimed at it. Resolves immediately when none is showing.
 */
export async function settle (page: Page) {
  const snack = page.locator('.v-snackbar--active').first()
  await snack.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
}

async function navigate (page: Page, to: 'Home' | 'Settings') {
  await settle(page)
  await page.getByRole('link', { name: to }).click()
}

/**
 * Home, waiting for whichever of its two shapes applies: the start button, or
 * the resume card that replaces it while a session is still open.
 */
export async function openHome (page: Page) {
  await navigate(page, 'Home')
  await expect(startButton(page).or(resumeCard(page))).toBeVisible()
}

export function startButton (page: Page) {
  return page.getByRole('button', { name: 'Start workout' })
}

export function resumeCard (page: Page) {
  return page.locator('.v-card').filter({ hasText: 'Resume workout' })
}

/** A row in Home's *Previous sessions* list. */
export function sessionRow (page: Page, text?: string | RegExp) {
  const rows = page.locator('.v-list-item')
  return text === undefined ? rows : rows.filter({ hasText: text })
}

export async function openSettings (page: Page) {
  await navigate(page, 'Settings')
  await expect(page.getByText('Backup', { exact: true })).toBeVisible()
}

/**
 * One entry card in the open session. Scoped to the card rather than matched on
 * text, because a closed Vuetify dialog stays mounted and its combobox still
 * holds the exercise name that was typed into it.
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
 * The exercise-history dialog: whichever dialog on screen is not the workout
 * one, since the two are open together whenever history is reached from it.
 */
export function historyDialog (page: Page) {
  return page.getByRole('dialog').filter({
    hasNot: page.getByRole('combobox', { name: 'Exercise' }),
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
export function tempoColumn (page: Page, index: number) {
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
export async function openBreakSheet (page: Page) {
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

export async function finishSession (page: Page) {
  await settle(page)
  await page.getByRole('button', { name: 'Finish' }).click()
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
  const button = page.getByRole('button', { name: unit, exact: true })
  await button.click()
  await expect(button).toHaveClass(/v-btn--active/)
}

/** Deletes the workout at the top of the Home list, confirming the dialog. */
export async function deleteNewestWorkout (page: Page) {
  await openHome(page)
  await page.locator('.v-list-item').first().getByRole('button').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
}

/** Every row in IndexedDB, tombstones included. */
export function storedSessions (page: Page): Promise<Session[]> {
  return page.evaluate(async () => {
    const settled = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.addEventListener('success', () => resolve(request.result))
      request.addEventListener('error', () => reject(request.error))
    })
    const db = await settled(indexedDB.open('workout-tracker'))
    try {
      return await settled(db.transaction('sessions').objectStore('sessions').getAll()) as Session[]
    } finally {
      db.close()
    }
  })
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

export async function logIn (
  page: Page,
  account: { url: string, username: string, password: string },
) {
  await openSettings(page)
  await page.getByLabel('Server URL').fill(account.url)
  await page.getByLabel('Username').fill(account.username)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Log in & sync' }).click()
  await expect(page.getByText(`Syncing as ${account.username}`)).toBeVisible({ timeout: 60_000 })
  // The login runs a first sync; let it finish before anything else starts one.
  await expect(page.getByRole('button', { name: 'Sync now' })).not.toHaveClass(
    /v-btn--loading/,
    { timeout: 60_000 },
  )
}

export async function syncNow (page: Page) {
  await openSettings(page)
  await settle(page)
  const button = page.getByRole('button', { name: 'Sync now' })
  await button.click()
  await expect(button).not.toHaveClass(/v-btn--loading/, { timeout: 60_000 })
}
