import type { Session, SessionEntry, WorkoutEntry } from '@/types/workout'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { broadcastDataReplaced, broadcastSessionChanged, onDataReplaced, onSessionChanged } from '@/services/broadcast'
import {
  clearSyncState,
  getAllSessions,
  getSession as getStoredSession,
  putSession,
  replaceAllSessions,
} from '@/services/db'
import { errorMessage } from '@/utils/error'
import { toDateKey } from '@/utils/format'

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
   * Restores a backup: the imported sessions become the entire local set.
   *
   * Sync bookkeeping is dropped along with the old data. It records what the
   * server has already seen per session, and an imported session whose
   * `updatedAt` sits at or below that stamp would look clean and never be
   * pushed — the restore would simply never leave the device. Clearing it also
   * drops the stoken, so the next sync re-pulls the collection in full and the
   * two sides converge under the usual last-write-wins rule.
   *
   * Unlike the other mutations, this one lets a failed write reject: the caller
   * awaits it and reports to the user, and nothing has been changed yet when
   * the DB write is the thing that failed.
   */
  async function importSessions (imported: Session[]) {
    await replaceAllSessions(imported)
    await clearSyncState()
    sessions.value = imported
    storageError.value = null
    broadcastDataReplaced()
    // The sync store watches this and schedules a run.
    mutationCount.value++
  }

  /**
   * Deletes every workout, reducing each session to a bare tombstone: the
   * entries and the note — everything the user actually wrote — are dropped
   * from disk rather than kept for an undo, which is the point of a button
   * that says it clears your data.
   *
   * Tombstones rather than removed rows, because that is how a single deleted
   * session already travels: sync bookkeeping is deliberately *not* cleared
   * here, so each tombstone is pushed as an update to the item the server
   * already holds and the deletion reaches the user's other devices. Dropping
   * the rows outright would leave the server copies untouched, and the next
   * sync would pull every workout straight back.
   *
   * Rejects on a failed write, like `importSessions`.
   */
  async function clearAllSessions () {
    const cleared = sessions.value.map<Session>(session => ({
      id: session.id,
      dateKey: session.dateKey,
      startTime: session.startTime,
      entries: [],
      updatedAt: nextUpdatedAt(session),
      deleted: true,
    }))
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
