<template>
  <div>
    <div class="text-caption text-medium-emphasis mb-1">
      Tempo · {{ formatTempo(tempo) }}
    </div>

    <v-row dense>
      <v-col
        v-for="(label, i) in labels"
        :key="label"
        class="text-center"
        cols="3"
      >
        <v-btn
          block
          :disabled="valueAt(i) >= 9"
          icon="mdi-plus"
          size="small"
          variant="tonal"
          @click="step(i, 1)"
        />

        <div class="text-h5 my-1">{{ valueAt(i) }}</div>

        <v-btn
          block
          :disabled="valueAt(i) <= 0"
          icon="mdi-minus"
          size="small"
          variant="tonal"
          @click="step(i, -1)"
        />

        <div class="text-caption text-medium-emphasis mt-1">{{ label }}</div>
      </v-col>
    </v-row>
  </div>
</template>

<script lang="ts" setup>
  import type { Tempo } from '@/types/workout'
  import { formatTempo } from '@/utils/format'

  const tempo = defineModel<Tempo>({ required: true })

  const labels = ['Down', 'Hold', 'Up', 'Hold']

  function valueAt (index: number): number {
    return tempo.value[index] ?? 0
  }

  function step (index: number, delta: number) {
    const next = [...tempo.value] as Tempo
    next[index] = Math.min(9, Math.max(0, valueAt(index) + delta))
    tempo.value = next
  }
</script>
