<template>
  <v-card class="mb-2" @click="emit('edit')">
    <v-card-item>
      <v-card-title class="text-subtitle-1 font-weight-bold">
        {{ entry.name }}
      </v-card-title>

      <v-card-subtitle>
        {{ entry.weight }} {{ entry.weightUnit }} × {{ entry.reps }} reps × {{ entry.sets }} sets
        · tempo {{ formatTempo(entry.tempo) }}
      </v-card-subtitle>

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
  import { formatTempo } from '@/utils/format'

  defineProps<{
    entry: WorkoutEntry
  }>()

  const emit = defineEmits<{
    edit: []
    history: []
  }>()
</script>
