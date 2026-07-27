<template>
  <div class="d-flex align-center ga-1 mb-2">
    <!-- Indented to where the handle inside an exercise card sits, which is
         the card's own padding in from the edge. -->
    <DragHandle
      class="ms-4"
      :label="label"
      @grab="emit('grab', $event)"
      @move="emit('move', $event)"
    />

    <!-- The row itself, and not the wrapper the handle shares with it: nesting
         a button inside something that is one confuses both the accessible
         name and the click. -->
    <div
      class="d-flex align-center justify-center ga-2 py-2 flex-grow-1 text-medium-emphasis"
      role="button"
      tabindex="0"
      @click="emit('edit')"
      @keydown.enter.prevent="emit('edit')"
      @keydown.space.prevent="emit('edit')"
    >
      <v-divider class="flex-grow-1" />
      <v-icon icon="$timerSand" size="small" />
      <span class="text-body-2 text-no-wrap">{{ label }}</span>
      <v-divider class="flex-grow-1" />
    </div>
  </div>
</template>

<script lang="ts" setup>
  import type { BreakEntry } from '@/types/workout'
  import { computed } from 'vue'
  import DragHandle from '@/components/session/DragHandle.vue'
  import { formatDuration } from '@/utils/format'

  const props = defineProps<{
    entry: BreakEntry
  }>()

  const emit = defineEmits<{
    edit: []
    grab: [event: PointerEvent]
    move: [delta: number]
  }>()

  const label = computed(() => `Break — ${formatDuration(props.entry.durationSec)}`)
</script>
