import type { Session } from '@/types/workout'
import type { DBSchema, IDBPDatabase } from 'idb'
import { openDB } from 'idb'

interface WorkoutDB extends DBSchema {
  sessions: {
    key: string
    value: Session
    indexes: { 'by-dateKey': string }
  }
}

let dbPromise: Promise<IDBPDatabase<WorkoutDB>> | undefined

function getDB (): Promise<IDBPDatabase<WorkoutDB>> {
  dbPromise ??= openDB<WorkoutDB>('workout-tracker', 1, {
    upgrade (db) {
      const store = db.createObjectStore('sessions', { keyPath: 'id' })
      store.createIndex('by-dateKey', 'dateKey')
    },
  })
  return dbPromise
}

/** Returns every stored session, including tombstoned ones. */
export async function getAllSessions (): Promise<Session[]> {
  const db = await getDB()
  return db.getAll('sessions')
}

export async function putSession (session: Session): Promise<void> {
  const db = await getDB()
  await db.put('sessions', toPlain(session))
}

/**
 * IndexedDB rejects Vue reactive proxies (structuredClone does too, even for
 * proxies nested inside raw objects), so serialize through JSON instead.
 */
function toPlain (session: Session): Session {
  // eslint-disable-next-line unicorn/prefer-structured-clone
  return JSON.parse(JSON.stringify(session))
}
