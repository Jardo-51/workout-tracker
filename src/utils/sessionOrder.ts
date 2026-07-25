import type { Session } from '@/types/workout'

/**
 * Total order over two versions of a session, computed identically on every
 * device: the newer `updatedAt` wins, and on a tie the lexicographically
 * larger serialization does.
 *
 * Ties are not a corner case. `nextUpdatedAt` derives the stamp from the
 * session's own previous value, so two devices editing the same synced copy
 * while their clocks sit at or behind it both produce the same stamp. Ordering
 * on `updatedAt` alone would then leave each device keeping its own version
 * and recording it as synced — diverging permanently, with neither side aware.
 *
 * Lives here rather than in the sync service because a backup import resolves
 * collisions with the same rule. Two implementations would be two behaviours:
 * whether a restored workout wins would depend on whether it arrived over the
 * wire or out of a file, which is not a distinction the user can see. It also
 * keeps the etebase bundle, which the sync service pulls in, out of the import
 * path.
 */
export function compareSessions (a: Session, b: Session): number {
  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt - b.updatedAt
  }
  const contentA = JSON.stringify(a)
  const contentB = JSON.stringify(b)
  if (contentA === contentB) {
    return 0
  }
  return contentA < contentB ? -1 : 1
}
