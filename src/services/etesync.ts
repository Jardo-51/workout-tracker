import type { Session } from '@/types/workout'
import * as Etebase from 'etebase'
import {
  getMeta,
  getSyncMeta,
  putSyncMeta,
  setMeta,
} from '@/services/db'

const COLLECTION_TYPE = 'workout-tracker.sessions'
const ITEM_TYPE = 'workout-session'
const BATCH_SIZE = 20
const META_COLLECTION_CACHE = 'etesync.collectionCache'
const META_STOKEN = 'etesync.stoken'

export type Account = Etebase.Account

export async function login (
  username: string,
  password: string,
  serverUrl: string,
): Promise<{ account: Account, savedSession: string }> {
  const account = await Etebase.Account.login(username, password, serverUrl)
  return { account, savedSession: await account.save() }
}

export function restoreAccount (savedSession: string): Promise<Account> {
  return Etebase.Account.restore(savedSession)
}

export async function logout (account: Account): Promise<void> {
  try {
    await account.logout()
  } catch {
    // Best effort — the server-side token expires anyway.
  }
}

async function ensureCollection (account: Account) {
  const collectionManager = account.getCollectionManager()
  const cached = await getMeta<Uint8Array>(META_COLLECTION_CACHE)
  if (cached) {
    return { collectionManager, collection: collectionManager.cacheLoad(cached) }
  }

  const existing = await collectionManager.list(COLLECTION_TYPE)
  let collection = existing.data[0]
  if (!collection) {
    collection = await collectionManager.create(
      COLLECTION_TYPE,
      { name: 'Workout Tracker', mtime: Date.now() },
      '',
    )
    await collectionManager.upload(collection)
  }
  await setMeta(META_COLLECTION_CACHE, collectionManager.cacheSave(collection))
  return { collectionManager, collection }
}

export interface SyncResult {
  pulled: number
  pushed: number
  /** Remote items that could not be read as a session and were skipped. */
  skipped: number
}

/**
 * Guards against content this version can't use: schema drift from a future
 * app version, or another client writing to the same collection. Only the
 * fields the sync engine itself relies on are checked.
 */
function isSession (value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<Session>
  return typeof candidate.id === 'string'
    && typeof candidate.updatedAt === 'number'
    && Array.isArray(candidate.entries)
}

/**
 * Returns undefined for an item this client can't make sense of. Such an item
 * must never throw out of the pull loop: the stoken is saved only once the
 * loop completes, so an item that always throws would make every future sync
 * re-pull the same page and abort — wedging sync for good.
 */
async function decodeSession (item: Etebase.Item): Promise<Session | undefined> {
  try {
    const parsed: unknown = JSON.parse(await item.getContent(Etebase.OutputFormat.String))
    if (isSession(parsed)) {
      return parsed
    }
    console.warn('[sync] skipping remote item, not a session:', item.uid)
  } catch (error) {
    console.warn('[sync] skipping unreadable remote item:', item.uid, error)
  }
  return undefined
}

/**
 * Two-way sync: pull remote changes since the saved stoken (last-write-wins
 * on session.updatedAt), then push every local session whose updatedAt is
 * newer than what the server has seen. Tombstoned sessions sync like any
 * other session, so deletions propagate.
 */
export async function syncSessions (
  account: Account,
  localSessions: Session[],
  applyRemote: (session: Session) => Promise<void>,
): Promise<SyncResult> {
  const { collectionManager, collection } = await ensureCollection(account)
  const itemManager = collectionManager.getItemManager(collection)

  // Pull
  let pulled = 0
  let skipped = 0
  let stoken = await getMeta<string>(META_STOKEN)
  for (;;) {
    const response = await itemManager.list({ stoken, limit: 50 })
    for (const item of response.data) {
      if (item.isDeleted) {
        continue
      }
      const remote = await decodeSession(item)
      if (!remote) {
        skipped++
        continue
      }
      const local = localSessions.find(s => s.id === remote.id)
      if (!local || remote.updatedAt > local.updatedAt) {
        await applyRemote(remote)
        pulled++
      }
      // If the local copy is newer, syncedUpdatedAt < local.updatedAt keeps it
      // dirty and the push phase below overwrites the server (last write wins).
      await putSyncMeta({
        sessionId: remote.id,
        itemUid: item.uid,
        cache: itemManager.cacheSave(item),
        syncedUpdatedAt: remote.updatedAt,
      })
    }
    stoken = response.stoken ?? stoken
    if (response.done) {
      break
    }
  }
  await setMeta(META_STOKEN, stoken)

  // Push
  const dirty: Array<{ session: Session, meta: Awaited<ReturnType<typeof getSyncMeta>> }> = []
  for (const session of localSessions) {
    const meta = await getSyncMeta(session.id)
    if (!meta || session.updatedAt > meta.syncedUpdatedAt) {
      dirty.push({ session, meta })
    }
  }

  let pushed = 0
  for (let offset = 0; offset < dirty.length; offset += BATCH_SIZE) {
    const chunk = dirty.slice(offset, offset + BATCH_SIZE)
    const batch: Array<{ item: Etebase.Item, sessionId: string, updatedAt: number }> = []
    for (const { session, meta } of chunk) {
      // Snapshot content and updatedAt together, before any await, so a
      // mutation happening mid-sync stays dirty for the next run.
      const content = JSON.stringify(session)
      const updatedAt = session.updatedAt
      let item: Etebase.Item
      if (meta) {
        item = itemManager.cacheLoad(meta.cache)
        await item.setContent(content)
        item.setMeta({ ...item.getMeta(), mtime: updatedAt })
      } else {
        item = await itemManager.create(
          { type: ITEM_TYPE, name: session.id, mtime: updatedAt },
          content,
        )
      }
      batch.push({ item, sessionId: session.id, updatedAt })
    }
    await itemManager.batch(batch.map(b => b.item))
    for (const { item, sessionId, updatedAt } of batch) {
      await putSyncMeta({
        sessionId,
        itemUid: item.uid,
        cache: itemManager.cacheSave(item),
        syncedUpdatedAt: updatedAt,
      })
    }
    pushed += batch.length
  }

  return { pulled, pushed, skipped }
}
