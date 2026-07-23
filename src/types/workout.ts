export type WeightUnit = 'kg' | 'lbs'

/** Seconds for each phase: eccentric, pause, concentric, pause. */
export type Tempo = [number, number, number, number]

export interface WorkoutEntry {
  id: string
  kind: 'workout'
  name: string
  /** Omitted when the exercise is done without a prescribed tempo. */
  tempo?: Tempo
  reps: number
  weight: number
  weightUnit: WeightUnit
  sets: number
}

export interface BreakEntry {
  id: string
  kind: 'break'
  durationSec: number
}

export type SessionEntry = WorkoutEntry | BreakEntry

export interface Session {
  id: string
  /** Local calendar date 'YYYY-MM-DD', frozen at creation. */
  dateKey: string
  startTime: number
  endTime?: number
  note?: string
  /** Array order is the chronological order within the session. */
  entries: SessionEntry[]
  /**
   * Bumped on every mutation; sync diffs on it and resolves conflicts
   * last-write-wins. Strictly increasing per session rather than a plain
   * `Date.now()` — see `nextUpdatedAt` in the sessions store.
   */
  updatedAt: number
  /** Tombstone: kept in the DB for sync, hidden in the UI. */
  deleted?: boolean
}
