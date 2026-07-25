import type { Session } from '@/types/workout'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store is only interesting here for what it decides to write; the DB and
// the cross-tab channel are neither available nor the point.
const db = vi.hoisted(() => ({
  getAllSessions: vi.fn(() => Promise.resolve([] as Session[])),
  getSession: vi.fn(),
  putSession: vi.fn(() => Promise.resolve()),
  replaceAllSessions: vi.fn((_sessions: Session[]) => Promise.resolve()),
  clearSyncState: vi.fn(() => Promise.resolve()),
}))
const broadcast = vi.hoisted(() => ({
  broadcastSessionChanged: vi.fn(),
  broadcastDataReplaced: vi.fn(),
  onSessionChanged: vi.fn(),
  onDataReplaced: vi.fn(),
}))
vi.mock('@/services/db', () => db)
vi.mock('@/services/broadcast', () => broadcast)

const { useSessionsStore } = await import('@/stores/sessions')

/** Ahead of the clock, so the bumped stamp is exactly `updatedAt + 1`. */
const FUTURE = Date.now() + 1_000_000

function makeSession (id: string): Session {
  return {
    id,
    dateKey: '2026-07-07',
    startTime: 1000,
    endTime: 2000,
    note: 'felt strong',
    entries: [{ id: `${id}-e`, kind: 'break', durationSec: 90 }],
    updatedAt: FUTURE,
  }
}

function storeWith (...sessions: Session[]) {
  const store = useSessionsStore()
  store.sessions = sessions
  return store
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('clearAllSessions', () => {
  it('leaves stripped tombstones when the clear has to propagate', async () => {
    const store = storeWith(makeSession('a'), makeSession('b'))

    await store.clearAllSessions(true)

    expect(db.replaceAllSessions).toHaveBeenCalledWith([
      { id: 'a', dateKey: '2026-07-07', startTime: 1000, entries: [], updatedAt: FUTURE + 1, deleted: true },
      { id: 'b', dateKey: '2026-07-07', startTime: 1000, entries: [], updatedAt: FUTURE + 1, deleted: true },
    ])
    expect(store.sessions).toEqual(db.replaceAllSessions.mock.calls[0]![0])
    expect(store.visibleSessions).toEqual([])
  })

  it('removes the rows outright when it must not propagate', async () => {
    const store = storeWith(makeSession('a'))

    await store.clearAllSessions(false)

    expect(db.replaceAllSessions).toHaveBeenCalledWith([])
    expect(store.sessions).toEqual([])
  })

  it('keeps the sync bookkeeping, so tombstones push as updates', async () => {
    await storeWith(makeSession('a')).clearAllSessions(true)

    expect(db.clearSyncState).not.toHaveBeenCalled()
  })

  it('tells other tabs and schedules a sync', async () => {
    const store = storeWith(makeSession('a'))
    const before = store.mutationCount

    await store.clearAllSessions(true)

    expect(broadcast.broadcastDataReplaced).toHaveBeenCalled()
    expect(store.mutationCount).toBe(before + 1)
  })

  it('rejects and changes nothing in memory when the write fails', async () => {
    const store = storeWith(makeSession('a'))
    db.replaceAllSessions.mockRejectedValueOnce(new Error('quota exceeded'))

    await expect(store.clearAllSessions(true)).rejects.toThrow('quota exceeded')
    expect(store.visibleSessions).toHaveLength(1)
  })
})

describe('importSessions', () => {
  it('replaces the local set and drops the sync bookkeeping', async () => {
    const store = storeWith(makeSession('old'))
    const imported = [makeSession('new')]

    await store.importSessions(imported)

    expect(db.replaceAllSessions).toHaveBeenCalledWith(imported)
    expect(db.clearSyncState).toHaveBeenCalled()
    expect(store.sessions).toEqual(imported)
  })

  it('imports verbatim, without bumping updatedAt', async () => {
    const store = storeWith()
    const imported = [makeSession('new')]

    await store.importSessions(imported)

    expect(store.sessions[0]!.updatedAt).toBe(FUTURE)
  })
})
