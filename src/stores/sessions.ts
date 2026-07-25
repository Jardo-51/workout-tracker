import type { Session, SessionEntry, WorkoutEntry } from '@/types/workout'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { broadcastDataReplaced, broadcastSessionChanged, onDataReplaced, onSessionChanged } from '@/services/broadcast'
import {
  getAllSessions,
  getSession as getStoredSession,
  getSyncMeta,
  putSession,
  putSyncMeta,
  replaceAllSessions,
} from '@/services/db'
import { errorMessage } from '@/utils/error'
import { toDateKey } from '@/utils/format'
import { compareSessions } from '@/utils/sessionOrder'

function normalizeName (name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Sync resolves conflicts last-write-wins on `updatedAt`, so a wall clock that
 * jumps backwards would make an edit look older than the version it replaces
 * and silently lose it. Deriving the stamp from the session's own previous
 * value keeps it strictly increasing regardless of the clock. Because a pulled
 * session carries the writing device's stamp, this also lets an edit made on a
 * device with a slow clock win over one from a device running ahead.
 *
 * The flip side is that two devices editing the same synced copy under a
 * lagging clock produce the *same* stamp; `compareSessions` in the sync service
 * breaks that tie on content so both still converge on one winner.
 */
function nextUpdatedAt (session: Session): number {
  return Math.max(Date.now(), session.updatedAt + 1)
}

export const useSessionsStore = defineStore('sessions', () => {
  const sessions = ref<Session[]>([])
  const loaded = ref(false)
  /** Bumped on every user-driven mutation; the sync store watches it. */
  const mutationCount = ref(0)
  /**
   * The last write IndexedDB rejected, or null once one succeeds. Every
   * mutation updates the reactive copy before the write resolves, so a
   * rejection leaves the UI showing data that is not on disk and will be gone
   * after a reload — App.vue watches this and tells the user. `at` makes each
   * failure a distinct object so the watcher fires again even when the message
   * repeats, as quota exhaustion does for every write in the session.
   */
  const storageError = ref<{ message: string, at: number } | null>(null)

  let loadPromise: Promise<void> | undefined

  async function loadSessions () {
    sessions.value = await getAllSessions()
    loaded.value = true
    // Another tab writing the same IndexedDB would otherwise be invisible
    // here, and our stale copy would overwrite its work on the next persist.
    onSessionChanged(id => void reloadSession(id))
    onDataReplaced(() => void reloadAllSessions())
  }

  /** Re-reads the whole store, dropping anything another tab removed. */
  async function reloadAllSessions () {
    sessions.value = await getAllSessions()
  }

  function load (): Promise<void> {
    loadPromise ??= loadSessions().catch(error => {
      // Holding on to the rejection would replay this failure for every later
      // caller; dropping it lets a retry re-read the DB.
      loadPromise = undefined
      throw error
    })
    return loadPromise
  }

  /**
   * Writes through to IndexedDB and lets other tabs know. A rejected write is
   * recorded rather than rethrown: the mutations that call this are fired from
   * click handlers that do not await them, so throwing would only produce an
   * unhandled rejection. The in-memory copy is deliberately left as it is —
   * the session may have been mutated again while the write was in flight, so
   * there is no version it would be correct to roll back to.
   */
  async function store (session: Session) {
    try {
      await putSession(session)
    } catch (error) {
      storageError.value = { message: errorMessage(error), at: Date.now() }
      return
    }
    storageError.value = null
    // Only after a successful write: peers react by re-reading the session
    // from the DB, so announcing a write that never landed tells them nothing.
    broadcastSessionChanged(session.id)
  }

  function mergeIntoMemory (session: Session) {
    const index = sessions.value.findIndex(s => s.id === session.id)
    if (index === -1) {
      sessions.value.push(session)
    } else {
      sessions.value[index] = session
    }
  }

  /**
   * Pulls another tab's write into this tab's memory. The stamp comparison is
   * load-bearing: a tab never hears its own broadcast, so a peer's older write
   * can land while our own newer put is still in flight, and reading the DB
   * unconditionally would replace our copy with the version it supersedes.
   */
  async function reloadSession (id: string) {
    const stored = await getStoredSession(id)
    const current = sessions.value.find(s => s.id === id)
    if (stored && (!current || stored.updatedAt >= current.updatedAt)) {
      mergeIntoMemory(stored)
    }
  }

  const visibleSessions = computed(() =>
    sessions.value
      .filter(s => !s.deleted)
      .toSorted((a, b) => b.startTime - a.startTime),
  )

  const activeSession = computed(() =>
    visibleSessions.value.find(s => s.endTime === undefined),
  )

  /** All workout entries paired with their session, oldest first. */
  const allWorkoutEntries = computed(() => {
    const result: Array<{ session: Session, entry: WorkoutEntry }> = []
    for (const session of visibleSessions.value.toReversed()) {
      for (const entry of session.entries) {
        if (entry.kind === 'workout') {
          result.push({ session, entry })
        }
      }
    }
    return result
  })

  /** Workout entries newest first. */
  const newestFirstEntries = computed(() => allWorkoutEntries.value.toReversed())

  /** Unique exercise names, most recently used first. */
  const exerciseNames = computed(() => {
    const seen = new Set<string>()
    const names: string[] = []
    for (const { entry } of newestFirstEntries.value) {
      const key = normalizeName(entry.name)
      if (!seen.has(key)) {
        seen.add(key)
        names.push(entry.name)
      }
    }
    return names
  })

  /** Newest entry with the given name across all sessions, incl. the active one. */
  function lastWorkoutEntry (name: string): WorkoutEntry | undefined {
    const key = normalizeName(name)
    return newestFirstEntries.value
      .find(({ entry }) => normalizeName(entry.name) === key)
      ?.entry
  }

  /** All occurrences of an exercise across sessions, newest session first. */
  function historyForExercise (name: string): Array<{ session: Session, entry: WorkoutEntry }> {
    const key = normalizeName(name)
    return newestFirstEntries.value
      .filter(({ entry }) => normalizeName(entry.name) === key)
  }

  function getSession (id: string): Session | undefined {
    return sessions.value.find(s => s.id === id && !s.deleted)
  }

  async function persist (session: Session) {
    session.updatedAt = nextUpdatedAt(session)
    await store(session)
    mutationCount.value++
  }

  /**
   * Applies a session pulled from the sync server: stored verbatim (no
   * updatedAt bump) and does not count as a user mutation.
   */
  async function upsertFromRemote (session: Session) {
    mergeIntoMemory(session)
    await store(session)
  }

  /**
   * Makes sure the sync engine will push these sessions, whatever their stamp.
   *
   * It pushes what is dirty, and dirty means `updatedAt > syncedUpdatedAt` —
   * strictly. A session that won its collision on `compareSessions`' content
   * tie-break keeps the stamp of the copy it replaced, so if that copy had been
   * synced the two are equal, the session is not dirty, and the server keeps
   * the content that lost. Nothing brings it back down either: the server's
   * item is unchanged, so no stoken delta mentions it. The device would just
   * quietly disagree with the account forever.
   *
   * Backdating what the server was last told by one is the same trick
   * `syncSessions` uses when a local copy beats an incoming remote one, and it
   * costs nothing when the session is dirty already, which is the usual case.
   */
  async function forceDirty (written: Session[]) {
    for (const session of written) {
      const meta = await getSyncMeta(session.id)
      if (meta && meta.syncedUpdatedAt >= session.updatedAt) {
        await putSyncMeta({ ...meta, syncedUpdatedAt: session.updatedAt - 1 })
      }
    }
  }

  /**
   * Restores a backup by merging it in: a session the file has and this device
   * does not is added, one both have is resolved by `compareSessions`, and one
   * only this device has is left alone. A deletion travels with it — the file
   * carries tombstones, so a workout deleted before the export was written is
   * deleted here too — but a session the file says nothing about is untouched.
   *
   * Merging rather than replacing, because replacing was only ever a
   * replacement on a device with sync switched off. With sync on, the next run
   * pulls the account back down and the end state is this merge anyway — so
   * the destructive version of the import was not a second way of restoring, it
   * was the same restore plus a data loss that depended on a setting in another
   * card. Clearing first and then importing still gives an exact restore, now
   * as a thing the user chooses rather than a side effect.
   *
   * Resolving with the sync engine's own comparison is what keeps the two
   * consistent: a restored workout wins, or does not, for the same reason
   * whether it came out of a file or off the server.
   *
   * The one collision `compareSessions` does not decide is a session the file
   * still has and this device has only as a tombstone — which is every session
   * in the file after a clear, the documented way to ask for an exact restore.
   * The tombstone is necessarily the newer of the two (the clear stamped it
   * after the export wrote the file), so the comparison would reject the whole
   * restore. The file wins those outright instead: a tombstone holds nothing
   * the user wrote, so there is nothing on this side to lose. It is given a
   * stamp above the tombstone rather than the file's own, because the tombstone
   * has by then reached the server and the other devices, and a restore
   * carrying the older stamp would lose to it there and be wiped on the next
   * sync — restored on this device, gone again a few seconds later.
   *
   * The sessions it writes are then run through `forceDirty`, so the merge's
   * outcome reaches the server even where it did not move the stamp.
   *
   * Unlike the other mutations, this one lets a failed write reject: the caller
   * awaits it and reports to the user, and nothing has been changed yet when
   * the DB write is the thing that failed.
   *
   * @returns how many of the file's workouts were actually applied. Tombstones
   * the file carries are applied too, but they are not workouts and the user is
   * not told about them.
   */
  async function importSessions (imported: Session[]): Promise<number> {
    const merged = [...sessions.value]
    const written: Session[] = []
    let workouts = 0
    for (const session of imported) {
      const index = merged.findIndex(s => s.id === session.id)
      const local = index === -1 ? undefined : merged[index]!
      if (!local) {
        merged.push(session)
      } else if (local.deleted && !session.deleted) {
        merged[index] = { ...session, updatedAt: nextUpdatedAt(local) }
      } else if (compareSessions(session, local) > 0) {
        merged[index] = session
      } else {
        continue
      }
      written.push(index === -1 ? session : merged[index]!)
      if (!session.deleted) {
        workouts++
      }
    }
    if (written.length === 0) {
      return 0
    }
    // Before the sessions themselves, so a rejection here leaves the import as
    // a whole undone. The cost is a session that was not imported after all
    // being re-pushed once, which the server ends up with the same either way.
    await forceDirty(written)
    await replaceAllSessions(merged)
    sessions.value = merged
    storageError.value = null
    broadcastDataReplaced()
    // The sync store watches this and schedules a run.
    mutationCount.value++
    return workouts
  }

  /**
   * Deletes every workout. Either way the entries and the note — everything
   * the user actually wrote — go, rather than being kept for an undo, which is
   * the point of a button that says it clears your data.
   *
   * `propagate` picks what is left behind, and the caller sets it from whether
   * sync is configured:
   *
   * - `true`: each session becomes a bare tombstone, the way a single deleted
   *   session already travels. Sync bookkeeping is deliberately *not* cleared,
   *   so each tombstone is pushed as an update to the item the server already
   *   holds and the deletion reaches the user's other devices. Dropping the
   *   rows here instead would leave the server copies untouched, and the next
   *   sync would pull every workout straight back.
   *
   * - `false`: the rows go too, leaving nothing on the device. Tombstones
   *   would outlive a logged-out clear and carry a stamp newer than anything
   *   on the server, so logging back in later would push them and delete the
   *   account's data then — turning "clear this device" into "clear the
   *   account", just deferred. Logging in again re-pulls the account's
   *   workouts, which is the same thing any other fresh device does.
   *
   * Rejects on a failed write, like `importSessions`.
   */
  async function clearAllSessions (propagate: boolean) {
    const cleared = propagate
      ? sessions.value.map<Session>(session => ({
          id: session.id,
          dateKey: session.dateKey,
          startTime: session.startTime,
          entries: [],
          // A session that is already a tombstone keeps its stamp: the server
          // has that deletion, and a fresh stamp would only push it again as
          // an identical update, on every clear, for every session the user
          // ever deleted. It is still stripped, because a delete leaves the
          // entries on the tombstone for the undo and a clear should not.
          updatedAt: session.deleted ? session.updatedAt : nextUpdatedAt(session),
          deleted: true,
        }))
      : []
    await replaceAllSessions(cleared)
    sessions.value = cleared
    storageError.value = null
    broadcastDataReplaced()
    mutationCount.value++
  }

  async function startSession (): Promise<Session> {
    const now = Date.now()
    const session: Session = {
      id: crypto.randomUUID(),
      dateKey: toDateKey(now),
      startTime: now,
      entries: [],
      updatedAt: now,
    }
    sessions.value.push(session)
    await store(session)
    mutationCount.value++
    return session
  }

  async function finishSession (id: string) {
    const session = getSession(id)
    if (!session) {
      return
    }
    session.endTime = Date.now()
    await persist(session)
  }

  async function reopenSession (id: string) {
    const session = getSession(id)
    if (!session) {
      return
    }
    session.endTime = undefined
    await persist(session)
  }

  async function updateSessionNote (id: string, note: string) {
    const session = getSession(id)
    if (!session) {
      return
    }
    session.note = note.trim() || undefined
    await persist(session)
  }

  async function deleteSession (id: string) {
    const session = getSession(id)
    if (!session) {
      return
    }
    session.deleted = true
    // Entries are kept on the tombstone (they already sync) so a delete can be
    // undone from a snackbar; visibleSessions filters deleted ones out anyway.
    await persist(session)
  }

  async function restoreSession (id: string) {
    // getSession hides tombstones, so look the session up directly.
    const session = sessions.value.find(s => s.id === id)
    if (!session || !session.deleted) {
      return
    }
    // Remove the flag entirely so a restored session is shape-identical to one
    // that was never deleted (rather than carrying "deleted":false forever).
    delete session.deleted
    await persist(session)
  }

  async function addEntry (sessionId: string, entry: SessionEntry) {
    const session = getSession(sessionId)
    if (!session) {
      return
    }
    session.entries.push(entry)
    await persist(session)
  }

  async function updateEntry (sessionId: string, entry: SessionEntry) {
    const session = getSession(sessionId)
    if (!session) {
      return
    }
    const index = session.entries.findIndex(e => e.id === entry.id)
    if (index === -1) {
      return
    }
    session.entries[index] = entry
    await persist(session)
  }

  async function removeEntry (sessionId: string, entryId: string) {
    const session = getSession(sessionId)
    if (!session) {
      return
    }
    session.entries = session.entries.filter(e => e.id !== entryId)
    await persist(session)
  }

  return {
    sessions,
    loaded,
    mutationCount,
    storageError,
    load,
    upsertFromRemote,
    importSessions,
    clearAllSessions,
    visibleSessions,
    activeSession,
    exerciseNames,
    lastWorkoutEntry,
    historyForExercise,
    getSession,
    startSession,
    finishSession,
    reopenSession,
    updateSessionNote,
    deleteSession,
    restoreSession,
    addEntry,
    updateEntry,
    removeEntry,
  }
})
