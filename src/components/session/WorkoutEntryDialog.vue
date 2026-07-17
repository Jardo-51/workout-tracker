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
  const sets = ref(3)
  const tempo = ref<Tempo>([2, 0, 2, 0])
  const confirmDelete = ref(false)

  const weightInvalid = ref(false)
  const repsInvalid = ref(false)
  const setsInvalid = ref(false)

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
    if (props.editEntry) {
      name.value = props.editEntry.name
      weight.value = props.editEntry.weight
      weightUnit.value = props.editEntry.weightUnit
      reps.value = props.editEntry.reps
      sets.value = props.editEntry.sets
      tempo.value = [...props.editEntry.tempo]
    } else {
      name.value = ''
      weight.value = 0
      weightUnit.value = app.weightUnit
      reps.value = 8
      sets.value = 3
      tempo.value = [2, 0, 2, 0]
    }
  })

  function onNamePicked (value: string | null) {
    if (props.editEntry || !value) {
      return
    }
    const last = store.lastWorkoutEntry(value)
    if (last) {
      weight.value = last.weight
      weightUnit.value = last.weightUnit
      reps.value = last.reps
      sets.value = last.sets
      tempo.value = [...last.tempo]
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
      tempo: [...tempo.value],
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
