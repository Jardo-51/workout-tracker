<template>
  <v-app>
    <v-main class="pb-16">
      <router-view />
    </v-main>

    <AppBottomNav />

    <v-snackbar
      v-model="app.snackbar"
      :color="app.snackbarColor"
      :timeout="app.snackbarAction ? 6000 : 3000"
    >
      {{ app.snackbarText }}

      <template v-if="app.snackbarAction" #actions>
        <v-btn variant="text" @click="runSnackbarAction">
          {{ app.snackbarAction.label }}
        </v-btn>
      </template>
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

  function runSnackbarAction () {
    app.snackbarAction?.handler()
    app.snackbar = false
  }

  watch(() => sessions.storageError, error => {
    if (error) {
      app.showSnackbar(`Could not save: ${error.message}`, 'error')
    }
  })

  watch(() => app.darkMode, dark => {
    theme.change(dark ? 'dark' : 'light')
    // Keep the browser/PWA chrome colour matching the active theme instead of
    // the hard-coded blue in index.html, which looked wrong in dark mode.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', String(theme.current.value.colors.background))
  }, { immediate: true })
</script>
