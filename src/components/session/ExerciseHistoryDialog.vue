<template>
  <v-dialog
    v-model="open"
    fullscreen
    transition="dialog-bottom-transition"
  >
    <v-card>
      <v-toolbar color="primary">
        <v-btn icon="mdi-close" @click="open = false" />
        <v-toolbar-title>{{ name }}</v-toolbar-title>
      </v-toolbar>

      <v-card-text v-if="history.length > 0" class="pa-0">
        <v-list lines="two">
          <template v-for="(group, dateKey) in grouped" :key="dateKey">
            <v-list-subheader>{{ formatDateKey(String(dateKey)) }}</v-list-subheader>

            <v-list-item v-for="item in group" :key="item.entry.id">
              <v-list-item-title>
                {{ item.entry.weight }} {{ item.entry.weightUnit }}
                × {{ item.entry.reps }} reps × {{ item.entry.sets }} sets
              </v-list-item-title>

              <v-list-item-subtitle>
                tempo {{ formatTempo(item.entry.tempo) }}
              </v-list-item-subtitle>
            </v-list-item>
          </template>
        </v-list>
      </v-card-text>

      <v-card-text v-else class="text-center text-medium-emphasis mt-16">
        <v-icon class="mb-4" icon="mdi-star-outline" size="64" />
        <div class="text-h6">First time doing this one</div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { Session, WorkoutEntry } from '@/types/workout'
  import { computed } from 'vue'
  import { useSessionsStore } from '@/stores/sessions'
  import { formatDateKey, formatTempo } from '@/utils/format'

  const props = defineProps<{
    name: string
  }>()

  const open = defineModel<boolean>({ required: true })

  const store = useSessionsStore()

  const history = computed(() => store.historyForExercise(props.name))

  /** Newest session first; entries within a day keep session order. */
  const grouped = computed(() => {
    const groups: Record<string, Array<{ session: Session, entry: WorkoutEntry }>> = {}
    for (const item of history.value) {
      (groups[item.session.dateKey] ??= []).push(item)
    }
    return groups
  })
</script>
