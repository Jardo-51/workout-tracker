import { expect, test } from '@playwright/test'
import {
  addBreakPreset,
  addCustomBreak,
  addExercise,
  breakRow,
  breakSheet,
  confirmCard,
  entryCard,
  entryList,
  fillWorkoutValues,
  finishSession,
  historyButton,
  historyDialog,
  noteButton,
  openAddExercise,
  openApp,
  openEntry,
  openHome,
  openSession,
  recordWorkout,
  resumeCard,
  saveEntry,
  sessionRow,
  setDefaultWeightUnit,
  setSessionNote,
  snackbar,
  startSession,
  stepper,
  workoutDialog,
} from './support/app'

/**
 * The screen the app is actually for: a session and the entries in it. The
 * backup specs walk through here — type a name, Add, Finish — but never below
 * the name field, and never back over an entry to change or remove it.
 */
test.describe('a workout session', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('records everything an entry can hold, and still has it after a reload', async ({ page }) => {
    await startSession(page)

    const dialog = await openAddExercise(page)
    await fillWorkoutValues(page, { name: 'Squat', weight: 60, reps: 5, tempo: [3, 1, 2, 0] })
    // Sets through the stepper's own buttons: they are the part of
    // StepperField that a typed value never reaches.
    await stepper(page, 'Sets').plus.click()
    await stepper(page, 'Sets').plus.click()
    await expect(stepper(page, 'Sets').field).toHaveValue('3')
    await dialog.getByRole('button', { name: 'Add' }).click()
    await expect(dialog).toBeHidden()

    const logged = '60 kg × 5 reps × 3 sets · tempo 3-1-2-0'
    await expect(entryCard(page, 'Squat')).toContainText(logged)

    await page.reload()
    await expect(entryCard(page, 'Squat')).toContainText(logged)
  })

  test('holds each field at the lowest value it allows', async ({ page }) => {
    await startSession(page)
    await openAddExercise(page)

    // Weight and sets open sitting on their floor; reps starts above its own.
    await expect(stepper(page, 'Weight').minus).toBeDisabled()
    await expect(stepper(page, 'Sets').minus).toBeDisabled()
    await expect(stepper(page, 'Reps').field).toHaveValue('8')

    await stepper(page, 'Reps').field.fill('1')
    await expect(stepper(page, 'Reps').minus).toBeDisabled()
  })

  test('edits an entry that is already there', async ({ page }) => {
    await startSession(page)
    await addExercise(page, 'Bench press', { weight: 40, reps: 10, sets: 2 })

    await openEntry(page, 'Bench press')
    // The dialog opens on what was saved, not on the defaults.
    await expect(stepper(page, 'Weight').field).toHaveValue('40')
    await fillWorkoutValues(page, { name: 'Incline bench press', weight: 45, reps: 8 })
    await saveEntry(page)

    await expect(entryCard(page, 'Incline bench press'))
      .toContainText('45 kg × 8 reps × 2 sets')
    // Changed in place rather than added alongside.
    await expect(entryList(page)).toHaveCount(1)
  })

  test('asks before deleting an entry, and keeps it when told not to', async ({ page }) => {
    await startSession(page)
    await addExercise(page, 'Deadlift')

    const dialog = await openEntry(page, 'Deadlift')
    const confirm = confirmCard(page, 'Delete this entry?')

    await dialog.getByRole('button', { name: 'Delete entry' }).click()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toBeHidden()
    // Cancel drops the confirmation only, leaving the entry open for editing.
    await expect(dialog).toBeVisible()
    await expect(entryCard(page, 'Deadlift')).toBeVisible()

    await dialog.getByRole('button', { name: 'Delete entry' }).click()
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(dialog).toBeHidden()
    await expect(entryCard(page, 'Deadlift')).toBeHidden()
    await expect(snackbar(page)).toHaveText('Entry deleted')
  })

  test('lets an entry keep the unit it was saved in when the default changes', async ({ page }) => {
    await startSession(page)
    await addExercise(page, 'Squat', { weight: 100, unit: 'lbs' })
    await expect(entryCard(page, 'Squat')).toContainText('100 lbs')

    await addExercise(page, 'Row', { weight: 30 })
    await expect(entryCard(page, 'Row')).toContainText('30 kg')

    await setDefaultWeightUnit(page, 'lbs')
    await openHome(page)
    await resumeCard(page).click()
    await page.waitForURL(/\/session\//)

    // What was logged is untouched...
    await expect(entryCard(page, 'Squat')).toContainText('100 lbs')
    await expect(entryCard(page, 'Row')).toContainText('30 kg')
    // ...and only what is added next starts in the new unit.
    await openAddExercise(page)
    await expect(workoutDialog(page).locator('.v-chip')).toHaveText('lbs')
  })

  test('takes breaks from a preset and from a typed duration, and deletes one', async ({ page }) => {
    await startSession(page)
    await addExercise(page, 'Squat')

    await addBreakPreset(page, 90)
    await expect(breakRow(page, '1 min 30 s')).toBeVisible()

    await addCustomBreak(page, 45)
    await expect(breakRow(page, '45 s')).toBeVisible()

    // Reopening a break edits it rather than adding another.
    const sheet = breakSheet(page)
    await breakRow(page, '45 s').click()
    await expect(sheet.getByText('Edit break')).toBeVisible()
    await sheet.getByLabel('Duration', { exact: true }).fill('75')
    await sheet.getByRole('button', { name: 'Save' }).click()
    await expect(sheet).toBeHidden()
    await expect(breakRow(page, '1 min 15 s')).toBeVisible()
    await expect(entryList(page)).toHaveCount(3)

    await breakRow(page, '1 min 15 s').click()
    await sheet.getByRole('button', { name: 'Delete break' }).click()
    await expect(sheet).toBeHidden()
    await expect(breakRow(page, '1 min 15 s')).toBeHidden()
    // Only that one: the other break and the exercise stay.
    await expect(breakRow(page, '1 min 30 s')).toBeVisible()
    await expect(entryCard(page, 'Squat')).toBeVisible()
  })

  test('keeps workouts and breaks in the order they were added', async ({ page }) => {
    await startSession(page)
    await addExercise(page, 'Squat')
    await addBreakPreset(page, 60)
    await addExercise(page, 'Bench press')
    await addCustomBreak(page, 45)
    await addExercise(page, 'Deadlift')

    const inOrder = [/^Squat/, /^Break — 1 min$/, /^Bench press/, /^Break — 45 s$/, /^Deadlift/]
    await expect(entryList(page)).toHaveText(inOrder)

    // The order is the stored one, not an artefact of how the page was built.
    await page.reload()
    await expect(entryList(page)).toHaveText(inOrder)
  })

  test('shows what was lifted last time, and says so when there was no last time', async ({ page }) => {
    await recordWorkout(page, 'Squat', { weight: 80, reps: 6, sets: 4, tempo: null })

    await startSession(page)
    await openAddExercise(page)
    await fillWorkoutValues(page, { name: 'Squat' })

    await historyButton(page).click()
    await expect(historyDialog(page)).toContainText('80 kg × 6 reps × 4 sets')
    await expect(historyDialog(page)).toContainText('without tempo')
    // The toolbar's close button, back to the entry being added.
    await historyDialog(page).locator('.v-toolbar').getByRole('button').first().click()
    await expect(historyDialog(page)).toBeHidden()

    // A name never used before has nothing to show.
    await fillWorkoutValues(page, { name: 'Farmer walk' })
    await historyButton(page).click()
    await expect(historyDialog(page)).toContainText('First time doing this one')
  })

  test('takes a note on the session, and keeps it', async ({ page }) => {
    await startSession(page)
    await addExercise(page, 'Squat')

    await expect(noteButton(page)).toHaveText('Add a note…')
    await setSessionNote(page, 'Felt strong')
    await setSessionNote(page, 'Felt strong, back a bit tight')

    await page.reload()
    await expect(noteButton(page)).toHaveText('Felt strong, back a bit tight')

    // Home shows it against the session it belongs to.
    await finishSession(page)
    await expect(sessionRow(page)).toContainText('Felt strong, back a bit tight')
  })

  test('reopens a finished session and takes more entries', async ({ page }) => {
    await recordWorkout(page, 'Squat')

    await openSession(page, /exercises/)
    await page.getByRole('button', { name: 'Reopen' }).click()
    // Reopened, it is the session in progress again: it wants finishing now.
    await expect(page.getByRole('button', { name: 'Finish' })).toBeVisible()

    await addExercise(page, 'Bench press')
    await expect(entryList(page)).toHaveCount(2)

    await finishSession(page)
    await expect(sessionRow(page)).toContainText('2 exercises')
    await expect(page.getByText('In progress')).toBeHidden()
  })
})
