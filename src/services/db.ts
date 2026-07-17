import type { Session } from '@/types/workout'
import type { DBSchema, IDBPDatabase } from 'idb'
import { openDB } from 'idb'

/**
 * Prefix for the keys in the generic `meta` store that belong to the sync
 * service. `clearSyncState` removes exactly these, so anything stored under
 * another prefix survives a logout.
 */
export const SYNC_META_PREFIX = 'etesync.'

/** Etebase sync bookkeeping for one session. */
export interface SessionSyncMeta {
  sessionId: string
  itemUid: string
  /** Serialized etebase item (itemManager.cacheSave). */
  cache: Uint8Array
  /** The session.updatedAt value that was last pushed to / pulled from the server. */
  syncedUpdatedAt: number
}

interface WorkoutDB extends DBSchema {
  sessions: {
    key: string
    value: Session
    indexes: { 'by-dateKey': string }
  }
  syncMeta: {
    key: string
    value: SessionSyncMeta
  }
  meta: {
    key: string
    value: unknown
  }
}

let dbPromise: Promise<IDBPDatabase<WorkoutDB>> | undefined

function getDB (): Promise<IDBPDatabase<WorkoutDB>> {
  dbPromise ??= openDB<WorkoutDB>('workout-tracker', 2, {
    upgrade (db, oldVersion) {
      if (oldVersion < 1) {
        const store = db.createObjectStore('sessions', { keyPath: 'id' })
        store.createIndex('by-dateKey', 'dateKey')
      }
      if (oldVersion < 2) {
        db.createObjectStore('syncMeta', { keyPath: 'sessionId' })
        db.createObjectStore('meta')
      }
    },
  }).catch((error: unknown) => {
    // Holding on to the rejection would replay this one failure for the rest
    // of the page's life; dropping it lets a later call retry the open. Some
    // causes are transient (a blocking upgrade in another tab, storage
    // pressure), so a retry is worth allowing.
    dbPromise = undefined
    throw error
  })
  return dbPromise
}

/** Returns every stored session, including tombstoned ones. */
export async function getAllSessions (): Promise<Session[]> {
  const db = await getDB()
  return db.getAll('sessions')
}

export async function getSession (id: string): Promise<Session | undefined> {
  const db = await getDB()
  return db.get('sessions', id)
}

export async function putSession (session: Session): Promise<void> {
  const db = await getDB()
  await db.put('sessions', toPlain(session))
}

export async function getSyncMeta (sessionId: string): Promise<SessionSyncMeta | undefined> {
  const db = await getDB()
  return db.get('syncMeta', sessionId)
}

export async function putSyncMeta (meta: SessionSyncMeta): Promise<void> {
  const db = await getDB()
  await db.put('syncMeta', meta)
}

export async function getMeta<T> (key: string): Promise<T | undefined> {
  const db = await getDB()
  return await db.get('meta', key) as T | undefined
}

export async function setMeta (key: string, value: unknown): Promise<void> {
  const db = await getDB()
  await db.put('meta', value, key)
}

/**
 * Drops all sync bookkeeping (on logout). Sessions themselves are kept.
 *
 * `meta` is generic app metadata, so only the sync service's own keys are
 * removed; clearing the store wholesale would silently discard anything else
 * that comes to live there.
 */
export async function clearSyncState (): Promise<void> {
  const db = await getDB()
  await db.clear('syncMeta')
  const keys = await db.getAllKeys('meta')
  await Promise.all(
    keys.filter(key => key.startsWith(SYNC_META_PREFIX)).map(key => db.delete('meta', key)),
  )
}

/**
 * IndexedDB rejects Vue reactive proxies (structuredClone does too, even for
 * proxies nested inside raw objects), so serialize through JSON instead.
 */
function toPlain (session: Session): Session {
  // eslint-disable-next-line unicorn/prefer-structured-clone
  return JSON.parse(JSON.stringify(session))
}
