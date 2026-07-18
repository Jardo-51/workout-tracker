<template>
  <v-container class="pa-4">
    <v-card
      v-if="store.activeSession"
      class="mb-4"
      color="primary"
      variant="tonal"
      @click="openSession(store.activeSession.id)"
    >
      <v-card-item>
        <template #prepend>
          <v-icon icon="$playCircle" size="large" />
        </template>

        <v-card-title>Resume workout</v-card-title>

        <v-card-subtitle>
          Started {{ formatTime(store.activeSession.startTime) }}
          · {{ workoutCount(store.activeSession) }} exercises
        </v-card-subtitle>
      </v-card-item>
    </v-card>

    <v-btn
      v-else
      block
      class="mb-4"
      color="primary"
      prepend-icon="$plus"
      size="x-large"
      @click="startWorkout"
    >
      Start workout
    </v-btn>

    <template v-if="pastSessions.length > 0">
      <div class="text-subtitle-2 text-medium-emphasis mb-2">Previous sessions</div>

      <v-card>
        <v-list lines="two">
          <v-list-item
            v-for="session in pastSessions"
            :key="session.id"
            @click="openSession(session.id)"
          >
            <v-list-item-title>
              {{ formatDateKey(session.dateKey) }}

              <v-chip
                v-if="!session.endTime"
                class="ml-1"
                color="primary"
                label
                size="x-small"
              >
                In progress
              </v-chip>
            </v-list-item-title>

            <v-list-item-subtitle>
              {{ formatTime(session.startTime) }}<template v-if="session.endTime">–{{ formatTime(session.endTime) }}</template>
              · {{ workoutCount(session) }} exercises
              <template v-if="session.note"> · {{ session.note }}</template>
            </v-list-item-subtitle>

            <template #append>
              <v-btn
                icon="$deleteOutline"
                variant="text"
                @click.stop="confirmDelete(session)"
              />
            </template>
          </v-list-item>
        </v-list>
      </v-card>
    </template>

    <div
      v-else-if="!store.activeSession"
      class="text-center text-medium-emphasis mt-16"
    >
      <v-icon class="mb-4" icon="$dumbbell" size="64" />
      <div class="text-h6">No workouts yet</div>
      <div class="text-body-2">Start your first one above</div>
    </div>

    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>Delete session?</v-card-title>

        <v-card-text>
          This removes the session from
          {{ sessionToDelete ? formatDateKey(sessionToDelete.dateKey) : '' }}
          and all its entries.
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" @click="doDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script lang="ts" setup>
  import type { Session } from '@/types/workout'
  import { computed, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { useAppStore } from '@/stores/app'
  import { useSessionsStore } from '@/stores/sessions'
  import { formatDateKey, formatTime } from '@/utils/format'

  const store = useSessionsStore()
  const app = useAppStore()
  const router = useRouter()

  const deleteDialog = ref(false)
  const sessionToDelete = ref<Session>()

  const pastSessions = computed(() =>
    store.visibleSessions.filter(s => s.id !== store.activeSession?.id),
  )

  function workoutCount (session: Session): number {
    return session.entries.filter(e => e.kind === 'workout').length
  }

  async function startWorkout () {
    const session = await store.startSession()
    router.push(`/session/${session.id}`)
  }

  function openSession (id: string) {
    router.push(`/session/${id}`)
  }

  function confirmDelete (session: Session) {
    sessionToDelete.value = session
    deleteDialog.value = true
  }

  async function doDelete () {
    if (sessionToDelete.value) {
      await store.deleteSession(sessionToDelete.value.id)
      app.showSnackbar('Session deleted')
    }
    deleteDialog.value = false
  }
</script>
