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

    <template v-for="entry in session.entries" :key="entry.id">
      <WorkoutEntryCard
        v-if="entry.kind === 'workout'"
        :entry="entry"
        @edit="openWorkoutEdit(entry)"
        @history="openHistory(entry.name)"
      />

      <BreakEntryRow
        v-else
        :entry="entry"
        @edit="openBreakEdit(entry)"
      />
    </template>

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
  /* Keep the last entries reachable above the fixed action bar. */
  padding-bottom: 96px !important;
}

.action-bar {
  position: fixed;
  right: 0;
  bottom: 56px; /* above the bottom navigation */
  left: 0;
  background: rgb(var(--v-theme-surface));
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
