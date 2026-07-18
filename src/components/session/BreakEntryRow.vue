<template>
  <div
    class="d-flex align-center justify-center ga-2 py-2 mb-2 text-medium-emphasis"
    role="button"
    tabindex="0"
    @click="emit('edit')"
    @keydown.enter.prevent="emit('edit')"
    @keydown.space.prevent="emit('edit')"
  >
    <v-divider class="flex-grow-1" />
    <v-icon icon="$timerSand" size="small" />
    <span class="text-body-2 text-no-wrap">Break — {{ formatDuration(entry.durationSec) }}</span>
    <v-divider class="flex-grow-1" />
  </div>
</template>

<script lang="ts" setup>
  import type { BreakEntry } from '@/types/workout'
  import { formatDuration } from '@/utils/format'

  defineProps<{
    entry: BreakEntry
  }>()

  const emit = defineEmits<{
    edit: []
  }>()
</script>
