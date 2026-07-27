import type * as dbModule from '@/services/db'
import type { Session } from '@/types/workout'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { SYNC_META_PREFIX } from '@/services/db.constants'
import 'fake-indexeddb/auto'

// The suite runs in the default `node` environment like every other one here;
// `fake-indexeddb/auto` supplies the handful of globals `idb` reaches for,
// which is all this layer needs — no DOM.

let db: typeof dbModule

beforeEach(async () => {
  // `db.ts` memoises its connection for the life of the module, so a clean
  // database means a fresh module too: a new factory on its own would leave
  // the previous test's connection, and its rows, still in reach.
  globalThis.indexedDB = new IDBFactory()
  vi.resetModules()
  db = await import('@/services/db')
})

afterEach(() => {
  vi.restoreAllMocks()
})

function makeSession (id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    dateKey: '2026-07-27',
    startTime: 1000,
    entries: [{ id: `${id}-e`, kind: 'break', durationSec: 90 }],
    updatedAt: 2000,
    ...overrides,
  }
}

async function seed (...sessions: Session[]): Promise<void> {
  for (const session of sessions) {
    await db.putSession(session)
  }
}

const DB_NAME = 'workout-tracker'

/**
 * Opens the database the way `db.ts` is not allowed to — at a chosen version,
 * with a chosen upgrade — so a test can set up the state `db.ts` then has to
 * cope with: an install still on version 1, or a version newer than the one it
 * asks for.
 */
function rawOpen (version: number, upgrade?: (database: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, version)
    request.addEventListener('upgradeneeded', () => upgrade?.(request.result))
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => reject(request.error ?? new Error('open failed')))
  })
}

function rawPut (database: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, 'readwrite')
    tx.objectStore(store).put(value)
    tx.addEventListener('complete', () => resolve())
    tx.addEventListener('error', () => reject(tx.error ?? new Error('put failed')))
  })
}

function rawDelete (): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(DB_NAME)
    request.addEventListener('success', () => resolve())
    request.addEventListener('error', () => reject(request.error ?? new Error('delete failed')))
  })
}

/**
 * Aborts the transaction once its `n`th request has succeeded — the clear is
 * the first, then one put per session. Anchoring on the success event rather
 * than on the call means the request has really been applied by the time the
 * abort has to undo it.
 *
 * The failure has to be injected. `toPlain` is a JSON round trip
 * (`db.ts:136-139`), so no value handed to `replaceAllSessions` can fail the
 * structured clone that would otherwise be the way to break a write.
 */
function abortAfterRequest (n: number): void {
  let issued = 0
  function abortIfNth (request: IDBRequest): IDBRequest {
    issued++
    if (issued === n) {
      request.addEventListener('success', () => request.transaction?.abort())
    }
    return request
  }

  const clear = IDBObjectStore.prototype.clear
  const put = IDBObjectStore.prototype.put

  // Both replacements need the store they were called on to hand the call
  // through to the real method, and a prototype method's receiver is `this`.
  /* eslint-disable unicorn/no-this-outside-of-class */
  vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (this: IDBObjectStore) {
    return abortIfNth(clear.call(this))
  })

  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<typeof put>
  ) {
    return abortIfNth(put.apply(this, args))
  })
  /* eslint-enable unicorn/no-this-outside-of-class */
}

type RejectionListener = (reason: unknown, promise: Promise<unknown>) => void

// The app's tsconfig deliberately keeps the Node globals out of `src`, so the
// one Node API this file needs is reached through `globalThis` and described
// here rather than pulled in project-wide.
const nodeProcess = (globalThis as unknown as {
  process: {
    listeners: (event: 'unhandledRejection') => RejectionListener[]
    removeAllListeners: (event: 'unhandledRejection') => void
    on: (event: 'unhandledRejection', listener: RejectionListener) => void
    off: (event: 'unhandledRejection', listener: RejectionListener) => void
  }
}).process

/**
 * Runs `run` with this file's own `unhandledRejection` listener in place of
 * the runner's, and returns whatever went unobserved.
 *
 * An abort rejects every write still in flight *and* `tx.done`, so the promise
 * nobody awaits becomes an unhandled rejection — which vitest reports as
 * `Unhandled Errors` beside a passing test rather than as a failure, and which
 * `dangerouslyIgnoreUnhandledErrors` would silence entirely. Taking the
 * listener over turns that side channel into an assertion the rollback tests
 * can make directly.
 */
async function withUnhandledRejections (run: () => Promise<void>): Promise<unknown[]> {
  const caught: unknown[] = []
  const capture = (reason: unknown): void => void caught.push(reason)
  const runners = nodeProcess.listeners('unhandledRejection')
  nodeProcess.removeAllListeners('unhandledRejection')
  nodeProcess.on('unhandledRejection', capture)
  try {
    await run()
    // Node only decides a rejection is unhandled after the microtask queue has
    // drained, which is later than the awaited call settling.
    await new Promise(resolve => setTimeout(resolve, 0))
  } finally {
    nodeProcess.off('unhandledRejection', capture)
    for (const runner of runners) {
      nodeProcess.on('unhandledRejection', runner)
    }
  }
  return caught
}

describe('opening the database', () => {
  it('retries the open after a failure rather than replaying it', async () => {
    // A database already at version 3 makes `db.ts`'s open a downgrade, which
    // IndexedDB refuses — the same shape of failure as a blocked upgrade in
    // another tab or a storage quota, and one this environment can produce.
    const newer = await rawOpen(3)
    newer.close()

    await expect(db.getAllSessions()).rejects.toThrow()

    // Remove the cause, then ask again. `getDB` drops the memoised promise on
    // rejection precisely so this second call opens rather than handing back
    // the first failure; memoising it would strand the page until a reload.
    await rawDelete()

    expect(await db.getAllSessions()).toEqual([])
  })

  it('keeps a version 1 install through the version 2 upgrade', async () => {
    const legacy = makeSession('a')
    const v1 = await rawOpen(1, database => {
      // What `oldVersion < 1` creates. Everything else in this file starts from
      // an empty factory and so runs that branch; this test is the only one
      // that arrives at `upgrade` with data already in the store.
      const store = database.createObjectStore('sessions', { keyPath: 'id' })
      store.createIndex('by-dateKey', 'dateKey')
    })
    await rawPut(v1, 'sessions', legacy)
    v1.close()

    // The first call opens at version 2, so `oldVersion` is 1 and only the
    // second branch runs. The workouts of an install that predates sync have
    // to survive it.
    expect(await db.getAllSessions()).toEqual([legacy])

    // And the stores that branch adds are there and usable.
    await db.setMeta('theme', 'dark')
    expect(await db.getMeta('theme')).toBe('dark')
    expect(await db.getSyncMeta('a')).toBeUndefined()
  })
})

describe('sessions round trip', () => {
  it('reads back what was written, tombstones included', async () => {
    const live = makeSession('a', { endTime: 5000, note: 'legs' })
    const tombstone = makeSession('b', { entries: [], deleted: true })

    await seed(live, tombstone)

    expect(await db.getSession('a')).toEqual(live)
    expect(await db.getAllSessions()).toEqual([live, tombstone])
  })

  it('returns undefined for a session that was never written', async () => {
    expect(await db.getSession('nope')).toBeUndefined()
  })

  it('overwrites on a second put of the same id', async () => {
    await seed(makeSession('a'))
    await db.putSession(makeSession('a', { note: 'later', updatedAt: 3000 }))

    expect(await db.getAllSessions()).toEqual([makeSession('a', { note: 'later', updatedAt: 3000 })])
  })
})

describe('replaceAllSessions', () => {
  it('swaps the store contents for the argument', async () => {
    await seed(makeSession('a'), makeSession('b'))

    await db.replaceAllSessions([makeSession('b', { note: 'kept' }), makeSession('c')])

    // 'a' was absent from the argument, so it is gone; 'b' was present, so the
    // argument's copy won; 'c' is new.
    expect(await db.getAllSessions()).toEqual([makeSession('b', { note: 'kept' }), makeSession('c')])
  })

  it('empties the store when given nothing', async () => {
    await seed(makeSession('a'), makeSession('b'))

    await db.replaceAllSessions([])

    expect(await db.getAllSessions()).toEqual([])
  })

  it('rolls the writes back when the transaction fails part-way', async () => {
    const before = [makeSession('a'), makeSession('b')]
    await seed(...before)
    // Request 2 is the put of 'x', so 'x' is written and 'y' never is.
    abortAfterRequest(2)

    const unhandled = await withUnhandledRejections(async () => {
      await expect(db.replaceAllSessions([makeSession('x'), makeSession('y')])).rejects.toThrow()
    })

    // The store holds neither, and holds exactly what it held before. This is
    // the promise `importSessions` and `clearAllSessions` both await: whatever
    // they were replacing is still there to be shown to the user.
    expect(await db.getAllSessions()).toEqual(before)
    // The rollback above is true of any single transaction and was true before
    // `tx.done` joined the `Promise.all`; this is the half that was not. The
    // abort rejects the writes and `tx.done` alike, so the caller has to be
    // listening to all of them — an import that hits the storage quota
    // otherwise logs an AbortError nobody asked for beside the error it does
    // report.
    expect(unhandled).toEqual([])
  })

  it('has still committed nothing, the clear included, at the last write', async () => {
    const before = [makeSession('a'), makeSession('b')]
    await seed(...before)
    // Request 3 is the put of 'y', the last one the call makes: everything the
    // transaction does has run when the abort arrives.
    abortAfterRequest(3)

    const unhandled = await withUnhandledRejections(async () => {
      await expect(db.replaceAllSessions([makeSession('x'), makeSession('y')])).rejects.toThrow()
    })

    // The clear and the puts have to be one transaction, and the clear is the
    // half that is easy to lose: in a browser a transaction commits as soon as
    // it has no pending request and control returns to the event loop, so a
    // clear awaited on its own can be durable long before the last put is
    // issued, leaving a store holding 'x' and nothing else.
    //
    // That timing is what this test cannot reach: fake-indexeddb resolves
    // request promises in a microtask, so the puts always win the race back
    // and an awaited clear rolls back here too. What is pinned is the weaker,
    // still worthwhile claim — the clear is inside the same transaction as the
    // last put, so nothing at all is durable when that put is undone.
    expect(await db.getAllSessions()).toEqual(before)
    expect(unhandled).toEqual([])
  })

  it('leaves the store intact when serializing the argument throws', async () => {
    const before = [makeSession('a'), makeSession('b')]
    await seed(...before)
    // `JSON.stringify` throws on a cycle, which is the one way an argument can
    // make `toPlain` fail. Serialized inside the request batch it would fail
    // with the clear already issued and nothing else pending to hold the
    // transaction open, so the clear alone would commit.
    const circular = makeSession('x') as Session & { self?: unknown }
    circular.self = circular

    await expect(db.replaceAllSessions([circular])).rejects.toThrow()

    expect(await db.getAllSessions()).toEqual(before)
  })
})

describe('meta and sync bookkeeping', () => {
  it('reads back a meta value under its key', async () => {
    await db.setMeta('theme', 'dark')

    expect(await db.getMeta('theme')).toBe('dark')
    expect(await db.getMeta('missing')).toBeUndefined()
  })

  it('keeps a sync meta cache binary', async () => {
    const meta = {
      sessionId: 'a',
      itemUid: 'uid-a',
      cache: new Uint8Array([1, 2, 3]),
      syncedUpdatedAt: 2000,
    }

    await db.putSyncMeta(meta)

    // Sessions go through `toPlain` and sync meta deliberately does not: a JSON
    // round trip would hand `cacheLoad` an object with numeric keys.
    expect(await db.getSyncMeta('a')).toEqual(meta)
  })

  it('clears only the sync service keys out of meta', async () => {
    await db.putSyncMeta({
      sessionId: 'a',
      itemUid: 'uid-a',
      cache: new Uint8Array([1]),
      syncedUpdatedAt: 2000,
    })
    await db.setMeta(`${SYNC_META_PREFIX}collectionUid`, 'col-1')
    await db.setMeta(`${SYNC_META_PREFIX}stoken`, 'stoken-1')
    await db.setMeta('theme', 'dark')

    await db.clearSyncState()

    expect(await db.getSyncMeta('a')).toBeUndefined()
    expect(await db.getMeta(`${SYNC_META_PREFIX}collectionUid`)).toBeUndefined()
    expect(await db.getMeta(`${SYNC_META_PREFIX}stoken`)).toBeUndefined()
    // The point of the prefix: a logout must not take generic app metadata
    // with it.
    expect(await db.getMeta('theme')).toBe('dark')
  })

  it('leaves the sessions alone', async () => {
    await seed(makeSession('a'))

    await db.clearSyncState()

    expect(await db.getAllSessions()).toEqual([makeSession('a')])
  })
})

describe('toPlain', () => {
  it('stores a reactive session, which IndexedDB would refuse', async () => {
    const session = reactive(makeSession('a'))

    // What the round trip is for: the store hands its own reactive objects
    // straight to these functions.
    expect(() => structuredClone(session)).toThrow()

    await db.putSession(session)

    expect(await db.getSession('a')).toEqual(makeSession('a'))
  })

  it('stores reactive sessions through replaceAllSessions too', async () => {
    await db.replaceAllSessions([reactive(makeSession('a')), reactive(makeSession('b'))])

    expect(await db.getAllSessions()).toEqual([makeSession('a'), makeSession('b')])
  })

  it('drops an optional field that was explicitly set to undefined', async () => {
    await db.putSession(makeSession('a', { endTime: undefined }))

    expect(await db.getSession('a')).not.toHaveProperty('endTime')
  })
})
