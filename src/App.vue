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

  const app = useAppStore()
  const theme = useTheme()

  const sessions = useSessionsStore()
  const sync = useSyncStore()
  sessions.load().then(() => sync.init())

  watch(() => app.darkMode, dark => {
    theme.change(dark ? 'dark' : 'light')
  }, { immediate: true })
</script>
