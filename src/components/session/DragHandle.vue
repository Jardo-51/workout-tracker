<template>
  <v-btn
    ref="button"
    :aria-label="`Reorder ${label}`"
    class="drag-handle"
    density="comfortable"
    icon="$drag"
    variant="text"
    @click.stop
    @keydown.down.prevent="move(1)"
    @keydown.up.prevent="move(-1)"
    @pointerdown.stop="emit('grab', $event)"
  />
</template>

<script lang="ts" setup>
  import { nextTick, useTemplateRef } from 'vue'

  defineProps<{
    /** What this handle moves, for anyone who cannot see which row it is on. */
    label: string
  }>()

  const emit = defineEmits<{
    grab: [event: PointerEvent]
    move: [delta: number]
  }>()

  const button = useTemplateRef('button')

  /**
   * Reordering the list moves this row's element rather than re-rendering it,
   * and a focused element that is moved is blurred on the way — which would
   * make every keypress after the first go nowhere, so the entry could only be
   * moved one place per trip through the tab order. Taking the focus back
   * leaves it on the entry it was on, which is what the arrow keys are for.
   */
  function move (delta: number) {
    emit('move', delta)
    void nextTick(() => (button.value?.$el as HTMLElement | undefined)?.focus())
  }
</script>

<style scoped>
.drag-handle {
  /* The browser would otherwise take the first vertical move as a scroll and
     never send another pointermove — which is the whole gesture. */
  touch-action: none;
  cursor: grab;
}

.drag-handle:active {
  cursor: grabbing;
}
</style>
