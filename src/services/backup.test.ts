import type { Session, WorkoutEntry } from '@/types/workout'
import { describe, expect, it } from 'vitest'
import { backupFileName, buildBackup, parseBackup } from '@/services/backup'

function workoutEntry (): WorkoutEntry {
  return {
    id: 'e1',
    kind: 'workout',
    name: 'Squat',
    reps: 5,
    weight: 100,
    weightUnit: 'kg',
    sets: 3,
  }
}

function makeSession (overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    dateKey: '2026-07-07',
    startTime: 1000,
    entries: [workoutEntry()],
    updatedAt: 2000,
    ...overrides,
  }
}

function file (sessions: unknown[]): string {
  return JSON.stringify({
    app: 'workout-tracker',
    version: 1,
    sessions,
    exportedAt: '2026-07-07T10:00:00.000Z',
  })
}

describe('parseBackup', () => {
  it('round-trips what buildBackup produced', () => {
    const sessions = [makeSession(), makeSession({ id: 's2', entries: [] })]
    expect(parseBackup(JSON.stringify(buildBackup(sessions)))).toEqual(sessions)
  })

  it('accepts the optional session fields', () => {
    const session = makeSession({ endTime: 5000, note: 'legs', deleted: true })
    expect(parseBackup(file([session]))).toEqual([session])
  })

  it('accepts a workout entry with a tempo and a break entry', () => {
    const session = makeSession({
      entries: [
        { ...workoutEntry(), tempo: [2, 0, 2, 0] },
        { id: 'e2', kind: 'break', durationSec: 90 },
      ],
    })
    expect(parseBackup(file([session]))).toEqual([session])
  })

  it('accepts an empty export', () => {
    expect(parseBackup(file([]))).toEqual([])
  })

  it.each([
    ['not JSON at all', 'nonsense', /valid JSON/],
    ['a JSON scalar', '42', /workout-tracker export/],
    ['another app\'s file that happens to fit', '{"sessions":[]}', /workout-tracker export/],
    ['a file from a newer format', '{"app":"workout-tracker","version":2,"sessions":[]}', /format 2/],
    ['a missing sessions array', '{"app":"workout-tracker","version":1}', /sessions/],
    ['sessions being an object', '{"app":"workout-tracker","version":1,"sessions":{}}', /sessions/],
  ])('rejects %s', (_name, text, expected) => {
    expect(() => parseBackup(text)).toThrow(expected)
  })

  it('marks the file with the app and the format version', () => {
    expect(buildBackup([])).toMatchObject({ app: 'workout-tracker', version: 1 })
  })

  it.each([
    ['id', {}, /missing id/],
    ['dateKey', { dateKey: '7. 7. 2026' }, /YYYY-MM-DD/],
    ['startTime', { startTime: 'now' }, /startTime/],
    ['endTime', { endTime: 'later' }, /endTime/],
    ['note', { note: 7 }, /note/],
    ['updatedAt', { updatedAt: undefined }, /updatedAt/],
    ['deleted', { deleted: 'yes' }, /deleted/],
    ['entries', { entries: 'none' }, /entries/],
  ])('rejects a bad %s', (field, overrides, expected) => {
    const session: Record<string, unknown> = { ...makeSession(), ...overrides }
    if (field === 'id' || field === 'updatedAt') {
      delete session[field]
    }
    expect(() => parseBackup(file([session]))).toThrow(expected)
  })

  it('reports which session is broken', () => {
    const text = file([makeSession(), makeSession({ id: 's2', dateKey: 'nope' })])
    expect(() => parseBackup(text)).toThrow(/index 1/)
  })

  it('accepts an entry of a kind it does not know, the way sync does', () => {
    // A newer version's entry travels through etesync.ts intact, so a device
    // can hold one; the file must not be the one channel that cannot carry it.
    const entries = [workoutEntry(), { id: 'e2', kind: 'stretch', seconds: 30 }]
    const text = file([{ ...makeSession(), entries }])

    expect(parseBackup(text)[0]!.entries).toEqual(entries)
  })

  it.each([
    ['a missing id', { id: undefined }],
    ['a missing name', { name: undefined }],
    ['a non-numeric weight', { weight: '100' }],
    ['an unknown weight unit', { weightUnit: 'stone' }],
    ['a three-part tempo', { tempo: [2, 0, 2] }],
  ])('rejects an entry with %s', (_name, overrides) => {
    const entry: Record<string, unknown> = { ...workoutEntry(), id: 'e2', ...overrides }
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete entry[key]
      }
    }
    const text = file([{ ...makeSession(), entries: [workoutEntry(), entry] }])
    expect(() => parseBackup(text)).toThrow(/invalid entry at index 1/)
  })

  it('rejects a break entry without a duration', () => {
    const text = file([{ ...makeSession(), entries: [{ id: 'e1', kind: 'break' }] }])
    expect(() => parseBackup(text)).toThrow(/invalid entry at index 0/)
  })

  it('rejects duplicate entry ids, which the UI cannot tell apart', () => {
    const entries = [workoutEntry(), { ...workoutEntry(), reps: 8 }]
    const text = file([{ ...makeSession(), entries }])

    expect(() => parseBackup(text)).toThrow(/entry at index 1 repeats id e1/)
  })

  it('rejects duplicate session ids, which would silently collapse on import', () => {
    const text = file([makeSession(), makeSession()])
    expect(() => parseBackup(text)).toThrow(/repeats id s1/)
  })
})

describe('backupFileName', () => {
  it('stamps the local date and time', () => {
    const at = new Date(2026, 6, 7, 9, 5, 3).getTime()
    expect(backupFileName(at)).toBe('workout-tracker-export-2026-07-07_09-05-03.json')
  })
})
