import type { BreakEntry, Session, SessionEntry, Tempo, WorkoutEntry } from '@/types/workout'
import { toDateKey } from '@/utils/format'

const APP = 'workout-tracker'
/**
 * Bump when the session shape changes in a way this parser could not read, and
 * branch on it here. Without a marker, `parseBackup` has nothing to branch on
 * and nothing to recognise its own files by: it would take any JSON object
 * with a plausible `sessions` array, including one belonging to another app,
 * and persist and sync whatever typechecked.
 */
const FORMAT_VERSION = 1

/** Shape of an exported JSON file. */
export interface Backup {
  app: typeof APP
  version: number
  sessions: Session[]
  exportedAt: string
}

export function buildBackup (sessions: Session[]): Backup {
  return {
    app: APP,
    version: FORMAT_VERSION,
    sessions,
    exportedAt: new Date().toISOString(),
  }
}

export function backupFileName (now: number = Date.now()): string {
  const d = new Date(now)
  const time = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(part => String(part).padStart(2, '0'))
    .join('-')
  return `workout-tracker-export-${toDateKey(now)}_${time}.json`
}

function isString (value: unknown): value is string {
  return typeof value === 'string'
}

function isFiniteNum (value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isTempo (value: unknown): value is Tempo {
  return Array.isArray(value) && value.length === 4 && value.every(isFiniteNum)
}

function isWorkoutEntry (o: Record<string, unknown>): o is WorkoutEntry & Record<string, unknown> {
  return isString(o.name)
    && isFiniteNum(o.reps)
    && isFiniteNum(o.weight)
    && (o.weightUnit === 'kg' || o.weightUnit === 'lbs')
    && isFiniteNum(o.sets)
    && (o.tempo === undefined || isTempo(o.tempo))
}

function isBreakEntry (o: Record<string, unknown>): o is BreakEntry & Record<string, unknown> {
  return isFiniteNum(o.durationSec)
}

/**
 * There is a second `isSessionEntry` in `etesync.ts`, and the difference is
 * deliberate: that one checks only what something dereferences, this one checks
 * every field of the kinds it knows, because a file is written by a human's
 * filesystem and can arrive edited or truncated in ways a sync item cannot.
 *
 * What they must agree on is which entries get through at all. A kind a future
 * version adds travels over sync intact, so a device on the newer version can
 * hold an entry this one has no rules for — and it would be perverse for the
 * file to be the one channel that could not carry it, aborting the import of a
 * whole backup over an entry that syncs in fine. So an unknown kind passes on
 * its id alone, exactly as it does over the wire.
 */
function isSessionEntry (value: unknown): value is SessionEntry {
  if (!value || typeof value !== 'object') {
    return false
  }
  const o = value as Record<string, unknown>
  if (!isString(o.id) || o.id.length === 0) {
    return false
  }
  if (o.kind === 'workout') {
    return isWorkoutEntry(o)
  }
  if (o.kind === 'break') {
    return isBreakEntry(o)
  }
  return true
}

/**
 * Validates one session, returning the reason it was rejected rather than a
 * bare boolean: an import that fails is the one moment the user needs to know
 * *what* about the file this version could not read.
 */
function sessionProblem (value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return 'not an object'
  }
  const o = value as Record<string, unknown>
  if (!isString(o.id) || o.id.length === 0) {
    return 'missing id'
  }
  if (!isString(o.dateKey) || !/^\d{4}-\d{2}-\d{2}$/.test(o.dateKey)) {
    return 'dateKey is not YYYY-MM-DD'
  }
  if (!isFiniteNum(o.startTime)) {
    return 'missing startTime'
  }
  if (o.endTime !== undefined && !isFiniteNum(o.endTime)) {
    return 'invalid endTime'
  }
  if (o.note !== undefined && !isString(o.note)) {
    return 'invalid note'
  }
  if (!isFiniteNum(o.updatedAt)) {
    return 'missing updatedAt'
  }
  if (o.deleted !== undefined && typeof o.deleted !== 'boolean') {
    return 'invalid deleted flag'
  }
  if (!Array.isArray(o.entries)) {
    return 'entries is not an array'
  }
  const entryIds = new Set<string>()
  for (const [index, entry] of o.entries.entries()) {
    if (!isSessionEntry(entry)) {
      return `invalid entry at index ${index}`
    }
    // An id is what updateEntry and removeEntry key on, and what the render
    // loop uses. Repeat one and the user gets an entry whose edits land on its
    // twin and that cannot be deleted on its own — malformed data outliving
    // the import, which is the thing this module is for. Same reason the
    // session ids below are checked.
    if (entryIds.has(entry.id)) {
      return `entry at index ${index} repeats id ${entry.id}`
    }
    entryIds.add(entry.id)
  }
  return undefined
}

/**
 * Parses and validates the contents of an export file.
 *
 * Validation is strict on purpose. Imported sessions are persisted and then
 * pushed to the sync server, so anything malformed that slipped through would
 * outlive the import — crashing the UI on every app start, or spreading to the
 * user's other devices.
 *
 * @throws Error describing the first problem found.
 */
export function parseBackup (text: string): Session[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return fail('not a valid JSON file')
  }
  if (!data || typeof data !== 'object') {
    return fail('not a workout-tracker export')
  }
  const { app, version, sessions } = data as Record<string, unknown>
  if (app !== APP) {
    return fail('not a workout-tracker export')
  }
  if (version !== FORMAT_VERSION) {
    // Nothing sensible to do with it, but say which way it is wrong: a file
    // from a newer version is a reason to update the app, not a broken file.
    return fail(`written in format ${String(version)}, and this version reads ${FORMAT_VERSION}`)
  }
  if (!Array.isArray(sessions)) {
    return fail('no "sessions" array found')
  }
  const seen = new Set<string>()
  for (const [index, session] of sessions.entries()) {
    const problem = sessionProblem(session)
    if (problem) {
      return fail(`session at index ${index} is invalid (${problem})`)
    }
    const { id } = session as Session
    if (seen.has(id)) {
      return fail(`session at index ${index} repeats id ${id}`)
    }
    seen.add(id)
  }
  return sessions as Session[]
}

function fail (reason: string): never {
  throw new Error(reason)
}
