<template>
  <v-container v-if="session" class="pa-4 session-page">
    <div class="d-flex align-center mb-1">
      <v-btn icon="$arrowLeft" variant="text" @click="router.push('/')" />

      <div class="flex-grow-1 ml-1">
        <div class="text-h6">{{ formatDateKey(session.dateKey) }}</div>

        <div class="text-body-2 text-medium-emphasis">
          {{ formatTime(session.startTime) }}<template v-if="session.endTime">–{{ formatTime(session.endTime) }}</template>
        </div>
      </div>

      <v-btn
        v-if="!session.endTime"
        color="primary"
        variant="tonal"
        @click="finish"
      >
        Finish
      </v-btn>

      <v-btn
        v-else
        variant="tonal"
        @click="store.reopenSession(session.id)"
      >
        Reopen
      </v-btn>
    </div>

    <div class="mb-4">
      <v-textarea
        v-if="editingNote"
        v-model="noteDraft"
        auto-grow
        autofocus
        density="compact"
        hide-details
        label="Note"
        rows="2"
        variant="outlined"
        @blur="saveNote"
      />

      <div
        v-else
        class="text-body-2 text-medium-emphasis py-1"
        role="button"
        tabindex="0"
        @click="startEditingNote"
        @keydown.enter.prevent="startEditingNote"
        @keydown.space.prevent="startEditingNote"
      >
        <v-icon icon="$noteEdit" size="small" />
        {{ session.note || 'Add a note…' }}
      </div>
    </div>

    <template v-for="(entry, index) in session.entries" :key="entry.id">
      <WorkoutEntryCard
        v-if="entry.kind === 'workout'"
        v-bind="drag.itemAttrs(index, entry.id)"
        :entry="entry"
        @edit="openWorkoutEdit(entry)"
        @grab="grabEntry"
        @history="openHistory(entry.name)"
        @move="nudgeEntry(index, $event)"
      />

      <BreakEntryRow
        v-else
        v-bind="drag.itemAttrs(index, entry.id)"
        :entry="entry"
        @edit="openBreakEdit(entry)"
        @grab="grabEntry"
        @move="nudgeEntry(index, $event)"
      />
    </template>

    <!-- Where an entry ended up after an arrow key moved it. A drag can be
         watched; a keyboard move cannot, and focus stays on the same handle
         afterwards, so without this the entry travels in silence. -->
    <div aria-live="polite" class="visually-hidden">{{ moveAnnouncement }}</div>

    <div
      v-if="session.entries.length === 0"
      class="text-center text-medium-emphasis mt-12 mb-4"
    >
      <v-icon class="mb-2" icon="$dumbbell" size="48" />
      <div class="text-body-1">Add your first exercise</div>
    </div>

    <div class="action-bar d-flex ga-2 pa-3">
      <v-btn
        class="flex-grow-1"
        color="primary"
        prepend-icon="$plus"
        size="large"
        @click="openWorkoutAdd"
      >
        Exercise
      </v-btn>

      <v-btn
        class="flex-grow-1"
        color="secondary"
        prepend-icon="$timerSand"
        size="large"
        variant="tonal"
        @click="openBreakAdd"
      >
        Break
      </v-btn>
    </div>

    <WorkoutEntryDialog
      v-model="workoutDialog"
      :edit-entry="workoutBeingEdited"
      @delete="removeEntry"
      @history="openHistory"
      @save="saveWorkout"
    />

    <BreakEntrySheet
      v-model="breakSheet"
      :edit-entry="breakBeingEdited"
      @delete="removeEntry"
      @save="saveBreak"
    />

    <ExerciseHistoryDialog
      v-model="historyDialog"
      :name="historyName"
    />
  </v-container>
</template>

<script lang="ts" setup>
  import type { BreakEntry, SessionEntry, WorkoutEntry } from '@/types/workout'
  import { computed, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import BreakEntryRow from '@/components/session/BreakEntryRow.vue'
  import BreakEntrySheet from '@/components/session/BreakEntrySheet.vue'
  import ExerciseHistoryDialog from '@/components/session/ExerciseHistoryDialog.vue'
  import WorkoutEntryCard from '@/components/session/WorkoutEntryCard.vue'
  import WorkoutEntryDialog from '@/components/session/WorkoutEntryDialog.vue'
  import { useDragReorder } from '@/composables/useDragReorder'
  import { useAppStore } from '@/stores/app'
  import { useSessionsStore } from '@/stores/sessions'
  import { formatDateKey, formatTime } from '@/utils/format'

  const route = useRoute()
  const router = useRouter()
  const store = useSessionsStore()
  const app = useAppStore()

  const session = computed(() => store.getSession(String(route.params.id)))

  watch([() => store.loaded, session], ([loaded, s]) => {
    if (loaded && !s) {
      app.showSnackbar('Session not found', 'error')
      router.replace('/')
    }
  }, { immediate: true })

  const workoutDialog = ref(false)
  const workoutBeingEdited = ref<WorkoutEntry>()
  const breakSheet = ref(false)
  const breakBeingEdited = ref<BreakEntry>()
  const historyDialog = ref(false)
  const historyName = ref('')
  const editingNote = ref(false)
  const noteDraft = ref('')

  function openWorkoutAdd () {
    workoutBeingEdited.value = undefined
    workoutDialog.value = true
  }

  function openWorkoutEdit (entry: WorkoutEntry) {
    workoutBeingEdited.value = entry
    workoutDialog.value = true
  }

  function openBreakAdd () {
    breakBeingEdited.value = undefined
    breakSheet.value = true
  }

  function openBreakEdit (entry: BreakEntry) {
    breakBeingEdited.value = entry
    breakSheet.value = true
  }

  function openHistory (name: string) {
    historyName.value = name
    historyDialog.value = true
  }

  async function saveWorkout (entry: WorkoutEntry) {
    await saveEntry(entry, !workoutBeingEdited.value)
  }

  async function saveBreak (entry: BreakEntry) {
    await saveEntry(entry, !breakBeingEdited.value)
  }

  async function saveEntry (entry: SessionEntry, isNew: boolean) {
    if (!session.value) {
      return
    }
    await (isNew
      ? store.addEntry(session.value.id, entry)
      : store.updateEntry(session.value.id, entry))
  }

  const drag = useDragReorder(dropEntry)

  /**
   * The entries as they stood when the drag currently in flight picked its row
   * up. Everything the drop is decided from was measured against that list —
   * the midpoints, and so the gap the finger ends up over — and a drag lasts
   * seconds, long enough for a sync or another tab to have replaced the
   * entries underneath it. Applying a gap counted in a list that no longer
   * exists would reorder whatever happens to be there now, so the move is
   * dropped instead. Both of those paths swap in a whole new session object,
   * which is why comparing the array is enough to notice.
   */
  let entriesAtPickup: SessionEntry[] | undefined

  function grabEntry (event: PointerEvent) {
    entriesAtPickup = session.value?.entries
    drag.start(event)
  }

  function dropEntry (entryId: string, to: number) {
    if (!session.value || session.value.entries !== entriesAtPickup) {
      return
    }
    void store.moveEntry(session.value.id, entryId, to)
  }

  const moveAnnouncement = ref('')

  /**
   * The keyboard way through the drag handle: one place up or down. This one
   * reads the entry out of the index in the same tick the key was pressed, so
   * there is no window for the list to change under it.
   */
  async function nudgeEntry (index: number, delta: number) {
    const moved = session.value
    const entry = moved?.entries[index]
    if (!moved || !entry) {
      return
    }
    await store.moveEntry(moved.id, entry.id, index + delta)
    // Read back rather than assumed: the store refuses to move an entry off
    // either end of the list, and at the ends the truthful thing to say is
    // that it is still where it was.
    const position = moved.entries.findIndex(e => e.id === entry.id) + 1
    const name = entry.kind === 'workout' ? entry.name : 'Break'
    moveAnnouncement.value = `${name}, position ${position} of ${moved.entries.length}`
  }

  async function removeEntry (entryId: string) {
    if (!session.value) {
      return
    }
    await store.removeEntry(session.value.id, entryId)
    app.showSnackbar('Entry deleted')
  }

  async function finish () {
    if (!session.value) {
      return
    }
    await store.finishSession(session.value.id)
    app.showSnackbar('Workout finished')
    router.push('/')
  }

  function startEditingNote () {
    noteDraft.value = session.value?.note ?? ''
    editingNote.value = true
  }

  async function saveNote () {
    editingNote.value = false
    if (session.value && noteDraft.value.trim() !== (session.value.note ?? '')) {
      await store.updateSessionNote(session.value.id, noteDraft.value)
    }
  }
</script>

<style scoped>
.session-page {
  /* Keep the last entries reachable above the fixed action bar, plus the iOS
     home-indicator inset the bar itself clears. */
  padding-bottom: calc(96px + env(safe-area-inset-bottom)) !important;
}

/* The row in the air: over the ones it is being dragged past, and without the
   transition below, since it is following a finger rather than animating.
   Opaque, so what it is passing over reads as underneath it rather than
   through it — a break row is only a line of text and shows straight
   through anything translucent. */
.drag-item--lifted {
  position: relative;
  z-index: 2;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 6px 16px rgba(0, 0, 0, 30%);
}

.drag-item--sliding {
  transition: transform 150ms ease;
}

/* In the accessibility tree and nowhere else. `display: none` would take it
   out of both, and a live region nobody can reach announces nothing. */
.visually-hidden {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  white-space: nowrap;
  clip-path: inset(50%);
}

.action-bar {
  position: fixed;
  right: 0;
  /* Above the bottom navigation, then above the home indicator on iOS. */
  bottom: calc(56px + env(safe-area-inset-bottom));
  left: 0;
  background: rgb(var(--v-theme-surface));
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
