<template>
  <v-dialog
    v-model="open"
    fullscreen
    transition="dialog-bottom-transition"
  >
    <v-card>
      <v-toolbar color="primary">
        <v-btn icon="$close" @click="open = false" />
        <v-toolbar-title>{{ editEntry ? 'Edit exercise' : 'Add exercise' }}</v-toolbar-title>

        <v-btn
          v-if="trimmedName"
          icon="$history"
          @click="emit('history', trimmedName)"
        />
      </v-toolbar>

      <v-card-text class="pt-6">
        <v-combobox
          v-model="name"
          autocapitalize="words"
          :autofocus="!editEntry"
          density="comfortable"
          :items="store.exerciseNames"
          label="Exercise"
          @update:model-value="onNamePicked"
        />

        <StepperField
          v-model="weight"
          v-model:invalid="weightInvalid"
          decimal
          label="Weight"
          :step="weightStep"
        >
          <template #append-inner>
            <v-chip
              label
              size="small"
              @click.stop="toggleUnit"
            >
              {{ weightUnit }}
            </v-chip>
          </template>
        </StepperField>

        <StepperField
          v-model="reps"
          v-model:invalid="repsInvalid"
          label="Reps"
          :min="1"
        />

        <StepperField
          v-model="sets"
          v-model:invalid="setsInvalid"
          label="Sets"
          :min="1"
        />

        <TempoInput v-model="tempo" class="mt-2" />
      </v-card-text>

      <v-card-actions class="pa-4 flex-column">
        <v-btn
          block
          color="primary"
          :disabled="!valid"
          size="x-large"
          variant="flat"
          @click="save"
        >
          {{ editEntry ? 'Save' : 'Add' }}
        </v-btn>

        <v-btn
          v-if="editEntry"
          block
          class="mt-2"
          color="error"
          variant="text"
          @click="confirmDelete = true"
        >
          Delete entry
        </v-btn>
      </v-card-actions>
    </v-card>

    <v-dialog v-model="confirmDelete" max-width="400">
      <v-card>
        <v-card-title>Delete this entry?</v-card-title>

        <v-card-actions>
          <v-spacer />
          <v-btn @click="confirmDelete = false">Cancel</v-btn>
          <v-btn color="error" @click="doDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { Tempo, WeightUnit, WorkoutEntry } from '@/types/workout'
  import { computed, ref, watch } from 'vue'
  import StepperField from '@/components/session/StepperField.vue'
  import TempoInput from '@/components/session/TempoInput.vue'
  import { useAppStore } from '@/stores/app'
  import { useSessionsStore } from '@/stores/sessions'
  import { DEFAULT_TEMPO } from '@/types/workout'

  const props = defineProps<{
    /** When set, the dialog edits this entry instead of adding a new one. */
    editEntry?: WorkoutEntry
  }>()

  const emit = defineEmits<{
    save: [entry: WorkoutEntry]
    delete: [entryId: string]
    history: [name: string]
  }>()

  const open = defineModel<boolean>({ required: true })

  const store = useSessionsStore()
  const app = useAppStore()

  const name = ref<string | null>('')
  const weight = ref(0)
  const weightUnit = ref<WeightUnit>('kg')
  const reps = ref(8)
  const sets = ref(1)
  const tempo = ref<Tempo | undefined>([...DEFAULT_TEMPO])
  const confirmDelete = ref(false)

  const weightInvalid = ref(false)
  const repsInvalid = ref(false)
  const setsInvalid = ref(false)

  // True once the user has adjusted any value field, so name-based prefill
  // doesn't silently overwrite their edits. Writes made by the dialog itself
  // (reset on open, prefill) go through applyValues and don't set it.
  const dirty = ref(false)
  let applyingValues = false

  watch([weight, weightUnit, reps, sets, tempo], () => {
    if (!applyingValues) {
      dirty.value = true
    }
  }, { deep: true, flush: 'sync' })

  function applyValues (fn: () => void) {
    applyingValues = true
    fn()
    applyingValues = false
    dirty.value = false
  }

  const weightStep = computed(() => weightUnit.value === 'kg' ? 2.5 : 5)

  const trimmedName = computed(() => name.value?.trim() ?? '')

  const valid = computed(() =>
    trimmedName.value.length > 0
    && weight.value >= 0
    && reps.value >= 1
    && sets.value >= 1
    && !weightInvalid.value
    && !repsInvalid.value
    && !setsInvalid.value,
  )

  watch(open, isOpen => {
    if (!isOpen) {
      return
    }
    confirmDelete.value = false
    weightInvalid.value = false
    repsInvalid.value = false
    setsInvalid.value = false
    applyValues(() => {
      if (props.editEntry) {
        name.value = props.editEntry.name
        weight.value = props.editEntry.weight
        weightUnit.value = props.editEntry.weightUnit
        reps.value = props.editEntry.reps
        sets.value = props.editEntry.sets
        tempo.value = props.editEntry.tempo ? [...props.editEntry.tempo] : undefined
      } else {
        name.value = ''
        weight.value = 0
        weightUnit.value = app.weightUnit
        reps.value = 8
        sets.value = 1
        tempo.value = [...DEFAULT_TEMPO]
      }
    })
  })

  function onNamePicked (value: string | null) {
    if (props.editEntry || !value || dirty.value) {
      return
    }
    const last = store.lastWorkoutEntry(value)
    if (last) {
      applyValues(() => {
        weight.value = last.weight
        weightUnit.value = last.weightUnit
        reps.value = last.reps
        sets.value = last.sets
        tempo.value = last.tempo ? [...last.tempo] : undefined
      })
    }
  }

  function toggleUnit () {
    weightUnit.value = weightUnit.value === 'kg' ? 'lbs' : 'kg'
  }

  function save () {
    emit('save', {
      id: props.editEntry?.id ?? crypto.randomUUID(),
      kind: 'workout',
      name: trimmedName.value,
      // Omit the key entirely rather than storing `tempo: undefined`, so a
      // locally-saved entry is shape-identical to one that came back from sync.
      ...(tempo.value ? { tempo: [...tempo.value] as Tempo } : {}),
      reps: reps.value,
      weight: weight.value,
      weightUnit: weightUnit.value,
      sets: sets.value,
    })
    open.value = false
  }

  function doDelete () {
    if (props.editEntry) {
      emit('delete', props.editEntry.id)
    }
    confirmDelete.value = false
    open.value = false
  }
</script>
