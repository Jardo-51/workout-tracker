import type { Session } from '@/types/workout'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compareSessions } from '@/utils/sessionOrder'

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

function makeSession (id = 'a'): Session {
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

/** The bare shape a delete or a clear leaves behind. */
function tombstoneFor (id: string, updatedAt: number): Session {
  return { id, dateKey: '2026-07-07', startTime: 1000, entries: [], updatedAt, deleted: true }
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
  const withStamp = (id: string, updatedAt: number): Session => ({ ...makeSession(id), updatedAt })

  it('adds what the device does not have, keeping what it does', async () => {
    const store = storeWith(makeSession('mine'))

    const applied = await store.importSessions([makeSession('theirs')])

    expect(applied).toBe(1)
    expect(store.sessions.map(s => s.id)).toEqual(['mine', 'theirs'])
  })

  it('never deletes a session the file does not mention', async () => {
    const store = storeWith(makeSession('a'), makeSession('b'))

    await store.importSessions([makeSession('c')])

    expect(store.sessions.map(s => s.id).toSorted()).toEqual(['a', 'b', 'c'])
  })

  it('overwrites a session the file has a newer copy of', async () => {
    const store = storeWith(withStamp('a', 100))

    const applied = await store.importSessions([{ ...withStamp('a', 200), note: 'from the file' }])

    expect(applied).toBe(1)
    expect(store.sessions[0]).toMatchObject({ updatedAt: 200, note: 'from the file' })
  })

  it('keeps the local copy when the file is behind, and writes nothing', async () => {
    const store = storeWith(withStamp('a', 200))

    const applied = await store.importSessions([{ ...withStamp('a', 100), note: 'stale' }])

    expect(applied).toBe(0)
    expect(store.sessions[0]!.updatedAt).toBe(200)
    expect(db.replaceAllSessions).not.toHaveBeenCalled()
    expect(store.mutationCount).toBe(0)
  })

  it('resolves an updatedAt tie the way the sync engine does', async () => {
    // Equal stamps fall through to the serialization compare, so the same
    // pair resolves identically whether it met here or over the wire.
    const local = { ...withStamp('a', 100), note: 'aaa' }
    const fromFile = { ...withStamp('a', 100), note: 'zzz' }
    const store = storeWith(local)

    await store.importSessions([fromFile])

    expect(store.sessions[0]).toEqual(compareSessions(fromFile, local) > 0 ? fromFile : local)
    expect(store.sessions[0]!.note).toBe('zzz')
  })

  it('restores a workout the device has only as a tombstone', async () => {
    const store = storeWith(tombstoneFor('a', FUTURE + 5))

    const applied = await store.importSessions([makeSession('a')])

    expect(applied).toBe(1)
    expect(store.visibleSessions).toHaveLength(1)
    expect(store.sessions[0]).toMatchObject({ id: 'a', note: 'felt strong' })
    // Above the tombstone, which the server and the other devices already have;
    // the file's own stamp would lose to it there and be wiped on the next sync.
    expect(store.sessions[0]!.updatedAt).toBe(FUTURE + 6)
  })

  it('restores everything after a clear, which is what clearing first is for', async () => {
    const exported = [makeSession('a'), makeSession('b')]
    const store = storeWith(makeSession('a'), makeSession('b'))
    await store.clearAllSessions(true)

    const applied = await store.importSessions(exported)

    expect(applied).toBe(2)
    expect(store.visibleSessions.map(s => s.id).toSorted()).toEqual(['a', 'b'])
    expect(store.visibleSessions[0]).toMatchObject({
      note: 'felt strong',
      entries: [{ id: 'a-e', kind: 'break', durationSec: 90 }],
    })
  })

  it('applies a deletion the file carries, and does not count it as a workout', async () => {
    const store = storeWith(withStamp('a', 100))

    const applied = await store.importSessions([tombstoneFor('a', 200)])

    expect(applied).toBe(0)
    expect(store.visibleSessions).toEqual([])
    expect(db.replaceAllSessions).toHaveBeenCalled()
  })

  it('keeps the sync bookkeeping — merged sessions are already dirty', async () => {
    await storeWith().importSessions([makeSession('a')])

    expect(db.clearSyncState).not.toHaveBeenCalled()
  })

  it('imports verbatim, without bumping updatedAt', async () => {
    const store = storeWith()

    await store.importSessions([makeSession('new')])

    expect(store.sessions[0]!.updatedAt).toBe(FUTURE)
  })

  it('rejects and changes nothing in memory when the write fails', async () => {
    const store = storeWith(makeSession('mine'))
    db.replaceAllSessions.mockRejectedValueOnce(new Error('quota exceeded'))

    await expect(store.importSessions([makeSession('theirs')])).rejects.toThrow('quota exceeded')
    expect(store.sessions.map(s => s.id)).toEqual(['mine'])
  })
})
