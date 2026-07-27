<template>
  <v-card class="mb-2" @click="emit('edit')">
    <v-card-item>
      <v-card-title class="text-subtitle-1 font-weight-bold">
        {{ entry.name }}
      </v-card-title>

      <v-card-subtitle>
        {{ entry.weight }} {{ entry.weightUnit }} × {{ entry.reps }} reps × {{ entry.sets }} sets
        <template v-if="entry.tempo">· tempo {{ formatTempo(entry.tempo) }}</template>
      </v-card-subtitle>

      <template #prepend>
        <DragHandle
          :label="entry.name"
          @grab="emit('grab', $event)"
          @move="emit('move', $event)"
        />
      </template>

      <template #append>
        <v-btn
          icon="$history"
          variant="text"
          @click.stop="emit('history')"
        />
      </template>
    </v-card-item>
  </v-card>
</template>

<script lang="ts" setup>
  import type { WorkoutEntry } from '@/types/workout'
  import DragHandle from '@/components/session/DragHandle.vue'
  import { formatTempo } from '@/utils/format'

  defineProps<{
    entry: WorkoutEntry
  }>()

  const emit = defineEmits<{
    edit: []
    grab: [event: PointerEvent]
    history: []
    move: [delta: number]
  }>()
</script>
