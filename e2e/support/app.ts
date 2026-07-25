import type { Session } from '../../src/types/workout'
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

export async function openHome (page: Page) {
  await navigate(page, 'Home')
  await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible()
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

/** Runs a whole workout: start, one exercise, finish. Ends up back on Home. */
export async function recordWorkout (page: Page, exercise: string) {
  await openHome(page)
  await page.getByRole('button', { name: 'Start workout' }).click()
  await page.waitForURL(/\/session\//)

  await settle(page)
  await page.getByRole('button', { name: 'Exercise', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'Exercise' }).fill(exercise)
  await dialog.getByRole('button', { name: 'Add' }).click()
  await expect(dialog).toBeHidden()
  await expect(entryCard(page, exercise)).toBeVisible()

  await settle(page)
  await page.getByRole('button', { name: 'Finish' }).click()
  await openHome(page)
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
