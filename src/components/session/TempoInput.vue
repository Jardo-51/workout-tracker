<template>
  <div>
    <div class="d-flex align-center ga-2 mb-1">
      <div class="text-caption text-medium-emphasis">
        Tempo<template v-if="tempo"> · {{ formatTempo(tempo) }}</template>
      </div>

      <v-spacer />

      <v-checkbox
        v-model="withoutTempo"
        color="primary"
        density="compact"
        hide-details
        label="Without tempo"
      />
    </div>

    <v-row v-if="tempo" dense>
      <v-col
        v-for="(label, i) in labels"
        :key="i"
        class="text-center"
        cols="3"
      >
        <v-btn
          block
          :disabled="valueAt(i) >= 9"
          icon="$plus"
          size="small"
          variant="tonal"
          @click="step(i, 1)"
        />

        <div class="text-h5 my-1">{{ valueAt(i) }}</div>

        <v-btn
          block
          :disabled="valueAt(i) <= 0"
          icon="$minus"
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
  import { computed } from 'vue'
  import { DEFAULT_TEMPO } from '@/types/workout'
  import { formatTempo } from '@/utils/format'

  const tempo = defineModel<Tempo | undefined>({ required: true })

  const labels = ['Down', 'Hold', 'Up', 'Hold']

  // Kept while "without tempo" is checked, so unchecking brings back what the
  // user had rather than the default.
  let lastTempo: Tempo = DEFAULT_TEMPO

  const withoutTempo = computed({
    get: () => !tempo.value,
    set (value: boolean) {
      if (value) {
        if (tempo.value) {
          lastTempo = tempo.value
        }
        tempo.value = undefined
      } else {
        tempo.value = [...lastTempo]
      }
    },
  })

  function valueAt (index: number): number {
    return tempo.value?.[index] ?? 0
  }

  function step (index: number, delta: number) {
    if (!tempo.value) {
      return
    }
    const next = [...tempo.value] as Tempo
    next[index] = Math.min(9, Math.max(0, valueAt(index) + delta))
    tempo.value = next
  }
</script>
