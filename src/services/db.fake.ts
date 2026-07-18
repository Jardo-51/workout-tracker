import type { SessionSyncMeta } from '@/services/db'
import { SYNC_META_PREFIX } from '@/services/db.constants'

/**
 * In-memory stand-in for the IndexedDB layer, for `etesync.test.ts`. Only the
 * functions `syncSessions` reaches for are here; sessions themselves stay out
 * of it, since the sync engine only ever touches those through the injected
 * `applyRemote`.
 */

const meta = new Map<string, unknown>()
const syncMeta = new Map<string, SessionSyncMeta>()

export function resetFakeDb (): void {
  meta.clear()
  syncMeta.clear()
}

export function getMeta<T> (key: string): Promise<T | undefined> {
  return Promise.resolve(meta.get(key) as T | undefined)
}

export function setMeta (key: string, value: unknown): Promise<void> {
  meta.set(key, value)
  return Promise.resolve()
}

export function getSyncMeta (sessionId: string): Promise<SessionSyncMeta | undefined> {
  return Promise.resolve(syncMeta.get(sessionId))
}

export function putSyncMeta (value: SessionSyncMeta): Promise<void> {
  syncMeta.set(value.sessionId, value)
  return Promise.resolve()
}

export function clearSyncState (): Promise<void> {
  syncMeta.clear()
  for (const key of meta.keys()) {
    if (key.startsWith(SYNC_META_PREFIX)) {
      meta.delete(key)
    }
  }
  return Promise.resolve()
}

/** Test-only views on the fake's state. */
export const fakeDb = {
  meta,
  syncMeta,
}
