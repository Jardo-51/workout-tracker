import { expect, test } from '@playwright/test'
import {
  addExercise,
  confirmCard,
  entryCard,
  openApp,
  openHome,
  recordWorkout,
  resumeCard,
  sessionRow,
  settle,
  startButton,
  startSession,
} from './support/app'

/**
 * Home, which is the first thing the app shows and has four shapes depending
 * on what is stored: nothing yet, a session still open, a list of finished
 * ones, and the confirmation for removing one of them.
 */
test.describe('the home screen', () => {
  // Both the list's ordering and its date headings are formatted through Intl,
  // so the run has to agree with the assertions about what day it is and how a
  // day is written.
  test.use({ locale: 'en-US', timezoneId: 'UTC' })

  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('says there is nothing yet before the first workout', async ({ page }) => {
    await expect(page.getByText('No workouts yet')).toBeVisible()
    await expect(page.getByText('Start your first one above')).toBeVisible()
    await expect(sessionRow(page)).toHaveCount(0)
    await expect(startButton(page)).toBeVisible()
  })

  test('offers to resume an open session, and goes back into it', async ({ page }) => {
    await startSession(page)
    await addExercise(page, 'Squat')
    await addExercise(page, 'Bench press')
    await openHome(page)

    // The open session replaces the start button rather than joining the list.
    await expect(startButton(page)).toBeHidden()
    await expect(resumeCard(page)).toContainText('2 exercises')
    await expect(sessionRow(page)).toHaveCount(0)

    await resumeCard(page).click()
    await page.waitForURL(/\/session\//)
    await expect(entryCard(page, 'Squat')).toBeVisible()
  })

  test('lists finished sessions newest first, one row a day', async ({ page }) => {
    // The only way to a second date: sessions take their day from the clock
    // when they start, and a run cannot wait for tomorrow.
    await page.clock.setFixedTime(new Date('2026-03-01T09:00:00Z'))
    await openApp(page)
    await recordWorkout(page, 'Squat')

    await page.clock.setFixedTime(new Date('2026-03-02T18:00:00Z'))
    await recordWorkout(page, 'Bench press')
    await recordWorkout(page, 'Deadlift')

    await openHome(page)
    await expect(sessionRow(page)).toHaveCount(3)
    await expect(sessionRow(page)).toHaveText([
      /Mar 2, 2026/,
      /Mar 2, 2026/,
      /Mar 1, 2026/,
    ])
    await expect(sessionRow(page).last()).toContainText('1 exercises')
  })

  test('keeps a session when the delete confirmation is cancelled', async ({ page }) => {
    await recordWorkout(page, 'Squat')
    await openHome(page)
    await settle(page)

    const confirm = confirmCard(page, 'Delete session?')
    await sessionRow(page).first().getByRole('button').click()
    await expect(confirm).toContainText('and all its entries')
    await confirm.getByRole('button', { name: 'Cancel' }).click()

    await expect(confirm).toBeHidden()
    await expect(sessionRow(page)).toHaveCount(1)

    // And the confirmation still deletes when it is the button that is meant.
    await sessionRow(page).first().getByRole('button').click()
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(sessionRow(page)).toHaveCount(0)
  })
})
