import type { BreakEntry, Session, SessionEntry, Tempo, WorkoutEntry } from '@/types/workout'
import { toDateKey } from '@/utils/format'

/** Shape of an exported JSON file. */
export interface Backup {
  sessions: Session[]
  exportedAt: string
}

export function buildBackup (sessions: Session[]): Backup {
  return { sessions, exportedAt: new Date().toISOString() }
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
  return false
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
  const badEntry = o.entries.findIndex(entry => !isSessionEntry(entry))
  if (badEntry !== -1) {
    return `invalid entry at index ${badEntry}`
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
  const { sessions } = data as Record<string, unknown>
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
