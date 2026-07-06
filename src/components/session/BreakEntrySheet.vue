<template>
  <v-bottom-sheet v-model="open">
    <v-card class="pa-4">
      <div class="text-h6 mb-3">{{ editEntry ? 'Edit break' : 'Add break' }}</div>

      <v-row v-if="!editEntry" class="mb-2" dense>
        <v-col v-for="preset in [60, 90, 120]" :key="preset" cols="4">
          <v-btn
            block
            color="primary"
            size="x-large"
            variant="tonal"
            @click="save(preset)"
          >
            {{ preset }} s
          </v-btn>
        </v-col>
      </v-row>

      <div class="d-flex align-center ga-2">
        <v-text-field
          v-model="custom"
          density="comfortable"
          hide-details
          inputmode="numeric"
          :label="editEntry ? 'Duration' : 'Custom duration'"
          suffix="s"
        />

        <v-btn
          color="primary"
          :disabled="!customValid"
          size="large"
          variant="flat"
          @click="save(Number.parseInt(custom, 10))"
        >
          {{ editEntry ? 'Save' : 'Add' }}
        </v-btn>
      </div>

      <v-btn
        v-if="editEntry"
        block
        class="mt-3"
        color="error"
        variant="text"
        @click="doDelete"
      >
        Delete break
      </v-btn>
    </v-card>
  </v-bottom-sheet>
</template>

<script lang="ts" setup>
  import type { BreakEntry } from '@/types/workout'
  import { computed, ref, watch } from 'vue'

  const props = defineProps<{
    /** When set, the sheet edits this break instead of adding a new one. */
    editEntry?: BreakEntry
  }>()

  const emit = defineEmits<{
    save: [entry: BreakEntry]
    delete: [entryId: string]
  }>()

  const open = defineModel<boolean>({ required: true })

  const custom = ref('')

  const customValid = computed(() => {
    const value = Number.parseInt(custom.value, 10)
    return !Number.isNaN(value) && value >= 1 && value <= 3600
  })

  watch(open, isOpen => {
    if (isOpen) {
      custom.value = props.editEntry ? String(props.editEntry.durationSec) : ''
    }
  })

  function save (durationSec: number) {
    emit('save', {
      id: props.editEntry?.id ?? crypto.randomUUID(),
      kind: 'break',
      durationSec,
    })
    open.value = false
  }

  function doDelete () {
    if (props.editEntry) {
      emit('delete', props.editEntry.id)
    }
    open.value = false
  }
</script>
