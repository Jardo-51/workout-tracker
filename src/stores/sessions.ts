import type { Session, SessionEntry, WorkoutEntry } from '@/types/workout'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { broadcastSessionChanged, onSessionChanged } from '@/services/broadcast'
import { getAllSessions, getSession as getStoredSession, putSession } from '@/services/db'
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

  let loadPromise: Promise<void> | undefined

  function load (): Promise<void> {
    loadPromise ??= (async () => {
      sessions.value = await getAllSessions()
      loaded.value = true
      // Another tab writing the same IndexedDB would otherwise be invisible
      // here, and our stale copy would overwrite its work on the next persist.
      onSessionChanged(id => void reloadSession(id))
    })()
    return loadPromise
  }

  /** Writes through to IndexedDB and lets other tabs know. */
  async function store (session: Session) {
    await putSession(session)
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

  /** Pulls another tab's write into this tab's memory. */
  async function reloadSession (id: string) {
    const stored = await getStoredSession(id)
    if (stored) {
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
    session.entries = []
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
    load,
    upsertFromRemote,
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
    addEntry,
    updateEntry,
    removeEntry,
  }
})
