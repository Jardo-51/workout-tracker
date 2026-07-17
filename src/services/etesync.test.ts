import type { Session } from '@/types/workout'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAccount, FakeServer } from '@/services/etesync.fake'

// The real module reaches for IndexedDB and, through etebase, for libsodium's
// wasm — neither exists here, and neither is what these tests are about.
vi.mock('@/services/db', () => import('@/services/db.fake'))
vi.mock('etebase', () => ({ OutputFormat: { Uint8Array: 0, String: 1 } }))

const { syncSessions } = await import('@/services/etesync')
const { fakeDb, resetFakeDb } = await import('@/services/db.fake')

const COLLECTION_TYPE = 'workout-tracker.sessions'

function makeSession (id: string, updatedAt: number, overrides: Partial<Session> = {}): Session {
  return {
    id,
    dateKey: '2026-07-07',
    startTime: 1000,
    entries: [],
    updatedAt,
    ...overrides,
  }
}

/** Collects what `syncSessions` pulled, standing in for the sessions store. */
function applyRemoteSpy () {
  const applied: Session[] = []
  const applyRemote = (session: Session) => {
    applied.push(session)
    return Promise.resolve()
  }
  return { applied, applyRemote }
}

describe('syncSessions', () => {
  let server: FakeServer

  beforeEach(() => {
    resetFakeDb()
    server = new FakeServer()
    vi.restoreAllMocks()
  })

  describe('push', () => {
    it('creates a server item for a session that has never synced', async () => {
      const local = [makeSession('s1', 10)]
      const { applyRemote } = applyRemoteSpy()

      const result = await syncSessions(fakeAccount(server), local, applyRemote)

      expect(result.pushed).toBe(1)
      const collectionUid = server.soleCollection()
      expect(server.contents(collectionUid)).toEqual([local[0]])
    })

    it('does not re-push a session that has not changed since the last sync', async () => {
      const local = [makeSession('s1', 10)]
      const { applyRemote } = applyRemoteSpy()
      const account = fakeAccount(server)

      await syncSessions(account, local, applyRemote)
      const second = await syncSessions(account, local, applyRemote)

      expect(second.pushed).toBe(0)
      expect(second.pulled).toBe(0)
    })

    it('re-pushes a session that was mutated after the last sync', async () => {
      const session = makeSession('s1', 10)
      const { applyRemote } = applyRemoteSpy()
      const account = fakeAccount(server)
      await syncSessions(account, [session], applyRemote)

      session.updatedAt = 20
      session.note = 'edited'
      const result = await syncSessions(account, [session], applyRemote)

      expect(result.pushed).toBe(1)
      const collectionUid = server.soleCollection()
      expect(server.contents(collectionUid)).toEqual([session])
    })

    it('pushes a tombstone so deletions propagate', async () => {
      const session = makeSession('s1', 10, { deleted: true, entries: [] })
      const { applyRemote } = applyRemoteSpy()

      await syncSessions(fakeAccount(server), [session], applyRemote)

      const collectionUid = server.soleCollection()
      expect(server.contents(collectionUid)).toEqual([
        expect.objectContaining({ id: 's1', deleted: true }),
      ])
    })

    it('pushes more sessions than fit in one batch', async () => {
      const local = Array.from({ length: 45 }, (_, i) => makeSession(`s${i}`, 10))
      const { applyRemote } = applyRemoteSpy()

      const result = await syncSessions(fakeAccount(server), local, applyRemote)

      expect(result.pushed).toBe(45)
      const collectionUid = server.soleCollection()
      expect(server.contents(collectionUid)).toHaveLength(45)
    })
  })

  describe('pull', () => {
    it('applies a remote session that is not present locally', async () => {
      const collection = server.seedCollection('col-a', COLLECTION_TYPE)
      const remote = makeSession('s1', 10, { note: 'from another device' })
      server.seedItem(collection.uid, 'item-1', JSON.stringify(remote))
      const { applied, applyRemote } = applyRemoteSpy()

      const result = await syncSessions(fakeAccount(server), [], applyRemote)

      expect(result.pulled).toBe(1)
      expect(applied).toEqual([remote])
    })

    it('pulls across pages until the server says done', async () => {
      const collection = server.seedCollection('col-a', COLLECTION_TYPE)
      for (let i = 0; i < 120; i++) {
        server.seedItem(collection.uid, `item-${i}`, JSON.stringify(makeSession(`s${i}`, 10)))
      }
      const { applied, applyRemote } = applyRemoteSpy()

      const result = await syncSessions(fakeAccount(server), [], applyRemote)

      expect(result.pulled).toBe(120)
      expect(applied).toHaveLength(120)
    })

    it('does not re-pull items already seen, on the next sync', async () => {
      const collection = server.seedCollection('col-a', COLLECTION_TYPE)
      server.seedItem(collection.uid, 'item-1', JSON.stringify(makeSession('s1', 10)))
      const account = fakeAccount(server)
      const first = applyRemoteSpy()
      await syncSessions(account, [], first.applyRemote)

      const second = applyRemoteSpy()
      const result = await syncSessions(account, [], second.applyRemote)

      expect(result.pulled).toBe(0)
      expect(second.applied).toEqual([])
    })
  })

  describe('conflicts', () => {
    it('takes the remote copy when it is newer', async () => {
      const collection = server.seedCollection('col-a', COLLECTION_TYPE)
      const remote = makeSession('s1', 20, { note: 'newer' })
      server.seedItem(collection.uid, 'item-1', JSON.stringify(remote))
      const local = [makeSession('s1', 10, { note: 'older' })]
      const { applied, applyRemote } = applyRemoteSpy()

      const result = await syncSessions(fakeAccount(server), local, applyRemote)

      expect(result.pulled).toBe(1)
      expect(applied).toEqual([remote])
    })

    it('keeps the local copy when it is newer, and pushes it over the remote', async () => {
      const collection = server.seedCollection('col-a', COLLECTION_TYPE)
      server.seedItem(collection.uid, 'item-1', JSON.stringify(makeSession('s1', 10, { note: 'older' })))
      const local = [makeSession('s1', 20, { note: 'newer' })]
      const { applied, applyRemote } = applyRemoteSpy()

      const result = await syncSessions(fakeAccount(server), local, applyRemote)

      expect(applied).toEqual([])
      expect(result.pushed).toBe(1)
      expect(server.contents(collection.uid)).toEqual([local[0]])
    })

    /**
     * The tie is the case that silently diverges if it is resolved by keeping
     * whatever each side has: both devices would record their own copy as
     * synced and stop talking about it. See `compareSessions`.
     */
    it('breaks an updatedAt tie the same way on both devices', async () => {
      const collection = server.seedCollection('col-a', COLLECTION_TYPE)
      const remote = makeSession('s1', 10, { note: 'bbb' })
      server.seedItem(collection.uid, 'item-1', JSON.stringify(remote))
      const local = [makeSession('s1', 10, { note: 'aaa' })]
      const { applied, applyRemote } = applyRemoteSpy()

      await syncSessions(fakeAccount(server), local, applyRemote)

      // 'bbb' sorts above 'aaa', so the remote wins on both sides: this device
      // adopts it, and the device that holds it leaves it alone.
      expect(applied).toEqual([remote])
      expect(server.contents(collection.uid)).toEqual([remote])
    })

    it('leaves an identical copy alone', async () => {
      const collection = server.seedCollection('col-a', COLLECTION_TYPE)
      const session = makeSession('s1', 10)
      server.seedItem(collection.uid, 'item-1', JSON.stringify(session))
      const { applied, applyRemote } = applyRemoteSpy()

      const result = await syncSessions(fakeAccount(server), [session], applyRemote)

      expect(applied).toEqual([])
      expect(result.pushed).toBe(0)
    })
  })

  describe('malformed remote items', () => {
    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    it.each([
      ['content that is not JSON', 'not json at all'],
      ['JSON that is not a session', JSON.stringify({ hello: 'world' })],
      ['a session with no updatedAt', JSON.stringify({ id: 's1', entries: [] })],
      ['a session whose entries are not an array', JSON.stringify({ id: 's1', updatedAt: 1, entries: 'nope' })],
      ['a workout entry with no name', JSON.stringify(makeSession('s1', 10, {
        entries: [{ id: 'e1', kind: 'workout' } as never],
      }))],
    ])('skips %s rather than aborting the sync', async (_label, content) => {
      const collection = server.seedCollection('col-a', COLLECTION_TYPE)
      server.seedItem(collection.uid, 'bad', content)
      server.seedItem(collection.uid, 'good', JSON.stringify(makeSession('s2', 10)))
      const { applied, applyRemote } = applyRemoteSpy()

      const result = await syncSessions(fakeAccount(server), [], applyRemote)

      expect(result.skipped).toBe(1)
      expect(applied.map(session => session.id)).toEqual(['s2'])
    })

    /**
     * The wedge this guards against: the stoken is saved only once the pull
     * loop completes, so an item that throws every time would make every later
     * sync re-pull the same page and abort. Sync would be dead for good.
     */
    it('does not re-read a skipped item forever', async () => {
      const collection = server.seedCollection('col-a', COLLECTION_TYPE)
      server.seedItem(collection.uid, 'bad', 'not json at all')
      const account = fakeAccount(server)
      const first = applyRemoteSpy()
      await syncSessions(account, [], first.applyRemote)

      const second = await syncSessions(account, [], applyRemoteSpy().applyRemote)

      expect(second.skipped).toBe(0)
    })

    it('lets a good session through in the same page as a bad item', async () => {
      const collection = server.seedCollection('col-a', COLLECTION_TYPE)
      server.seedItem(collection.uid, 'bad', '{{{')
      const good = makeSession('s1', 10)
      server.seedItem(collection.uid, 'good', JSON.stringify(good))
      const { applied, applyRemote } = applyRemoteSpy()

      await syncSessions(fakeAccount(server), [], applyRemote)

      expect(applied).toEqual([good])
    })
  })

  describe('collection selection', () => {
    it('creates the collection on first sync', async () => {
      await syncSessions(fakeAccount(server), [], applyRemoteSpy().applyRemote)

      expect([...server.collections.values()].map(collection => collection.type))
        .toEqual([COLLECTION_TYPE])
    })

    it('reuses a collection another device already created', async () => {
      server.seedCollection('col-existing', COLLECTION_TYPE)

      await syncSessions(fakeAccount(server), [makeSession('s1', 10)], applyRemoteSpy().applyRemote)

      expect([...server.collections.keys()]).toEqual(['col-existing'])
      expect(server.contents('col-existing')).toHaveLength(1)
    })

    /**
     * Finding #7: two fresh devices both see an empty list and each upload a
     * collection. Without a deterministic winner they would sync into separate
     * collections forever, with nothing surfacing it.
     */
    it('converges on the lowest uid when two collections exist', async () => {
      server.seedCollection('col-b', COLLECTION_TYPE)
      server.seedCollection('col-a', COLLECTION_TYPE)

      await syncSessions(fakeAccount(server), [makeSession('s1', 10)], applyRemoteSpy().applyRemote)

      expect(server.contents('col-a')).toHaveLength(1)
      expect(server.contents('col-b')).toHaveLength(0)
    })

    it('re-pushes into the winner when the cached collection lost the race', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      // This device synced into col-b before the other device's col-a existed.
      server.seedCollection('col-b', COLLECTION_TYPE)
      const local = [makeSession('s1', 10)]
      await syncSessions(fakeAccount(server), local, applyRemoteSpy().applyRemote)
      expect(server.contents('col-b')).toHaveLength(1)

      // The other device's collection shows up and wins on uid. A fresh
      // account stands in for the next app start, when the check runs.
      server.seedCollection('col-a', COLLECTION_TYPE)
      const result = await syncSessions(fakeAccount(server), local, applyRemoteSpy().applyRemote)

      // Without dropping the sync bookkeeping the session would look clean and
      // stay stranded in col-b.
      expect(result.pushed).toBe(1)
      expect(server.contents('col-a')).toEqual(local)
    })

    it('checks the collection once per app start, not once per sync', async () => {
      const account = fakeAccount(server)
      await syncSessions(account, [], applyRemoteSpy().applyRemote)
      const afterFirst = server.collectionListCount

      await syncSessions(account, [], applyRemoteSpy().applyRemote)

      expect(server.collectionListCount).toBe(afterFirst)
    })
  })

  describe('sync bookkeeping', () => {
    it('records the item uid and synced stamp for a pushed session', async () => {
      await syncSessions(fakeAccount(server), [makeSession('s1', 10)], applyRemoteSpy().applyRemote)

      expect(fakeDb.syncMeta.get('s1')).toMatchObject({ sessionId: 's1', syncedUpdatedAt: 10 })
    })

    /**
     * A local copy that beat the remote has to stay dirty so the push phase
     * overwrites the server. Recording the remote's stamp verbatim would mark
     * it clean whenever the two stamps are equal — which is exactly when the
     * tie-break runs — stranding the winning copy on this device forever.
     */
    it('leaves a session that beat the remote on a tie dirty enough to push', async () => {
      const collection = server.seedCollection('col-a', COLLECTION_TYPE)
      server.seedItem(collection.uid, 'item-1', JSON.stringify(makeSession('s1', 10, { note: 'aaa' })))
      // Same stamp, content that wins the tie-break, so local must survive.
      const local = [makeSession('s1', 10, { note: 'zzz' })]

      const result = await syncSessions(fakeAccount(server), local, applyRemoteSpy().applyRemote)

      expect(result.pulled).toBe(0)
      expect(result.pushed).toBe(1)
      expect(server.contents(collection.uid)).toEqual(local)
    })
  })
})
