<template>
  <v-app>
    <v-main class="pb-16">
      <router-view />
    </v-main>

    <AppBottomNav />

    <v-snackbar
      v-model="app.snackbar"
      :color="app.snackbarColor"
      :timeout="3000"
    >
      {{ app.snackbarText }}
    </v-snackbar>
  </v-app>
</template>

<script lang="ts" setup>
  import { watch } from 'vue'
  import { useTheme } from 'vuetify'
  import AppBottomNav from '@/components/layout/AppBottomNav.vue'
  import { useAppStore } from '@/stores/app'
  import { useSessionsStore } from '@/stores/sessions'
  import { useSyncStore } from '@/stores/sync'
  import { errorMessage } from '@/utils/error'

  const app = useAppStore()
  const theme = useTheme()

  const sessions = useSessionsStore()
  const sync = useSyncStore()

  // Without the catch, an unavailable IndexedDB (private-browsing modes,
  // storage pressure) renders an empty app with no explanation, and sync never
  // starts because init() hangs off the same chain.
  sessions.load()
    .then(() => sync.init())
    .catch((error: unknown) => {
      app.showSnackbar(`Could not open local storage: ${errorMessage(error)}`, 'error')
    })

  watch(() => sessions.storageError, message => {
    if (message) {
      app.showSnackbar(`Could not save: ${message}`, 'error')
    }
  })

  watch(() => app.darkMode, dark => {
    theme.change(dark ? 'dark' : 'light')
  }, { immediate: true })
</script>
