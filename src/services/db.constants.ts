/**
 * Prefix for the keys in the generic `meta` store that belong to the sync
 * service. `clearSyncState` removes exactly these, so anything stored under
 * another prefix survives a logout.
 *
 * Kept in its own module so the real db and its test fake (`db.fake.ts`) share
 * one source of truth: the fake can't import `@/services/db` — under test that
 * resolves back to the fake — so without this the two would each declare the
 * prefix and could drift silently.
 */
export const SYNC_META_PREFIX = 'etesync.'
