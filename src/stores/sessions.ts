import type { Session, SessionEntry, WorkoutEntry } from '@/types/workout'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getAllSessions, putSession } from '@/services/db'
import { toDateKey } from '@/utils/format'

function normalizeName (name: string): string {
  return name.trim().toLowerCase()
}

export const useSessionsStore = defineStore('sessions', () => {
  const sessions = ref<Session[]>([])
  const loaded = ref(false)

  async function load () {
    if (loaded.value) {
      return
    }
    sessions.value = await getAllSessions()
    loaded.value = true
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
    session.updatedAt = Date.now()
    await putSession(session)
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
    await putSession(session)
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
    load,
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
