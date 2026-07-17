import type { Account } from '@/services/etesync'

/**
 * An in-memory stand-in for the parts of the etebase API that `syncSessions`
 * uses, for `etesync.test.ts`.
 *
 * It models the two server behaviours the sync engine is written against, and
 * which the real API would otherwise only exercise over the network:
 *
 * - `list({ stoken })` returns only what changed after that token, so a test
 *   can assert that a second sync is a no-op rather than a full re-pull;
 * - collections and items are stored server-side and handed back as fresh
 *   objects, so a "device" cannot accidentally observe another's mutations
 *   through a shared reference.
 *
 * Item caches are plain JSON here. The real ones are opaque encrypted blobs,
 * so a test must never inspect one — only round-trip it through `cacheLoad`.
 */

interface StoredItem {
  uid: string
  content: string
  meta: Record<string, unknown>
  isDeleted: boolean
  /** Server revision at the last write; drives stoken-based listing. */
  rev: number
}

interface StoredCollection {
  uid: string
  type: string
  items: Map<string, StoredItem>
}

export class FakeServer {
  readonly collections = new Map<string, StoredCollection>()
  /** Every list() call made against this server, for asserting on traffic. */
  collectionListCount = 0
  private rev = 0
  private uidCounter = 0

  nextUid (prefix: string): string {
    this.uidCounter++
    return `${prefix}-${String(this.uidCounter).padStart(3, '0')}`
  }

  nextRev (): number {
    this.rev++
    return this.rev
  }

  /** Seeds an item as if another device had pushed it. */
  seedItem (collectionUid: string, uid: string, content: string): void {
    const collection = this.collections.get(collectionUid)!
    collection.items.set(uid, { uid, content, meta: {}, isDeleted: false, rev: this.nextRev() })
  }

  seedCollection (uid: string, type: string): StoredCollection {
    const collection = { uid, type, items: new Map<string, StoredItem>() }
    this.collections.set(uid, collection)
    return collection
  }

  /**
   * The uid of the only collection on the server. Fails loudly when there is
   * more than one, which for a test that did not set out to create a second is
   * itself the bug worth hearing about.
   */
  soleCollection (): string {
    const [uid, ...rest] = this.collections.keys()
    if (uid === undefined || rest.length > 0) {
      throw new Error(`expected exactly one collection, found ${this.collections.size}`)
    }
    return uid
  }

  /** Contents of a collection, decoded, for assertions. */
  contents (collectionUid: string): unknown[] {
    return [...this.collections.get(collectionUid)!.items.values()]
      .filter(item => !item.isDeleted)
      .map(item => JSON.parse(item.content))
  }
}

/** A handle on `FakeServer` shaped like `Etebase.Item`. */
class FakeItem {
  constructor (
    public uid: string,
    public content: string,
    public meta: Record<string, unknown>,
    public isDeleted = false,
  ) {}

  getContent (): Promise<string> {
    return Promise.resolve(this.content)
  }

  setContent (content: string): Promise<void> {
    this.content = content
    return Promise.resolve()
  }

  getMeta (): Record<string, unknown> {
    return this.meta
  }

  setMeta (meta: Record<string, unknown>): void {
    this.meta = meta
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

class FakeItemManager {
  constructor (private server: FakeServer, private collectionUid: string) {}

  private get stored () {
    return this.server.collections.get(this.collectionUid)!
  }

  list ({ stoken, limit = 50 }: { stoken?: string, limit?: number }) {
    const since = stoken ? Number(stoken) : 0
    const changed = [...this.stored.items.values()]
      .filter(item => item.rev > since)
      .toSorted((a, b) => a.rev - b.rev)
    const page = changed.slice(0, limit)
    const done = page.length === changed.length
    return Promise.resolve({
      data: page.map(item => new FakeItem(item.uid, item.content, { ...item.meta }, item.isDeleted)),
      // A page with nothing in it must not move the token backwards to 0.
      stoken: String(page.at(-1)?.rev ?? since),
      done,
    })
  }

  create (meta: Record<string, unknown>, content: string) {
    return Promise.resolve(new FakeItem(this.server.nextUid('item'), content, meta))
  }

  batch (items: FakeItem[]): Promise<void> {
    for (const item of items) {
      this.stored.items.set(item.uid, {
        uid: item.uid,
        content: item.content,
        meta: { ...item.meta },
        isDeleted: item.isDeleted,
        rev: this.server.nextRev(),
      })
    }
    return Promise.resolve()
  }

  cacheSave (item: FakeItem): Uint8Array {
    return encoder.encode(JSON.stringify({ uid: item.uid, content: item.content, meta: item.meta }))
  }

  cacheLoad (cache: Uint8Array): FakeItem {
    const { uid, content, meta } = JSON.parse(decoder.decode(cache))
    return new FakeItem(uid, content, meta)
  }
}

class FakeCollection {
  constructor (public uid: string, private type: string, public isDeleted = false) {}

  getCollectionType (): string {
    return this.type
  }
}

class FakeCollectionManager {
  constructor (private server: FakeServer) {}

  list (type: string) {
    this.server.collectionListCount++
    const data = [...this.server.collections.values()]
      .filter(collection => collection.type === type)
      .map(collection => new FakeCollection(collection.uid, collection.type))
    return Promise.resolve({ data, done: true, stoken: '' })
  }

  create (type: string, _meta: unknown, _content: string) {
    // Not on the server until upload(), mirroring the real API — the gap
    // between the two is exactly where the first-login race lives.
    return Promise.resolve(new FakeCollection(this.server.nextUid('col'), type))
  }

  upload (collection: FakeCollection): Promise<void> {
    this.server.seedCollection(collection.uid, collection.getCollectionType())
    return Promise.resolve()
  }

  getItemManager (collection: FakeCollection): FakeItemManager {
    return new FakeItemManager(this.server, collection.uid)
  }

  cacheSave (collection: FakeCollection): Uint8Array {
    return encoder.encode(JSON.stringify({ uid: collection.uid, type: collection.getCollectionType() }))
  }

  cacheLoad (cache: Uint8Array): FakeCollection {
    const { uid, type } = JSON.parse(decoder.decode(cache))
    return new FakeCollection(uid, type)
  }
}

/** An `Account` backed by `server`, for passing to `syncSessions`. */
export function fakeAccount (server: FakeServer): Account {
  const collectionManager = new FakeCollectionManager(server)
  return { getCollectionManager: () => collectionManager } as unknown as Account
}
