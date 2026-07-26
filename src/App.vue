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
      @update:model-value="onSnackbarToggle"
    >
      {{ app.snackbarText }}

      <template #actions>
        <v-btn
          v-if="app.snackbarAction"
          variant="text"
          @click="runSnackbarAction"
        >
          {{ app.snackbarAction.label }}
        </v-btn>

        <!-- Only when there is nothing else in here. Next to an Undo this
             would be a small target beside the one thing the user still wants,
             and a mis-tap would take the undo away for good — the timeout is
             the whole window they get. -->
        <v-btn
          v-else
          aria-label="Close"
          icon="$close"
          size="small"
          variant="text"
          @click="dismissSnackbar"
        />
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
    dismissSnackbar()
  }

  /**
   * Closes the snackbar from this side, which Vuetify gives no other way of
   * doing: VSnackbar renders its overlay `persistent`, so Escape does not close
   * it, and it does not forward `closeOnContentClick` either — without the
   * button in the actions slot a message can only be waited out.
   *
   * Clearing the action here is not a duplicate of {@link onSnackbarToggle}:
   * that fires on `update:model-value`, which Vuetify emits when it closes
   * *itself*, not when the model is set from out here.
   */
  function dismissSnackbar () {
    app.snackbar = false
    app.snackbarAction = null
  }

  // Clear the action whenever the snackbar closes on its own — which, with no
  // close button on an action-carrying message and no swipe support in
  // VSnackbar, means the timeout — so a stale handler closing over an old
  // session id can't fire again if the snackbar is ever re-shown without going
  // through showSnackbar.
  function onSnackbarToggle (value: boolean) {
    if (!value) {
      app.snackbarAction = null
    }
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
