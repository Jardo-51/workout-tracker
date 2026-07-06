<template>
  <v-card class="mb-4">
    <v-card-title>Etesync sync</v-card-title>

    <v-card-text v-if="!sync.configured">
      <div class="text-body-2 text-medium-emphasis mb-4">
        Optional: sync your workouts to an Etesync (Etebase) server.
        Without it, everything stays on this device.
      </div>

      <v-form @submit.prevent="doLogin">
        <v-text-field
          v-model="server"
          autocapitalize="off"
          density="comfortable"
          label="Server URL"
        />

        <v-text-field
          v-model="username"
          autocapitalize="off"
          density="comfortable"
          label="Username"
        />

        <v-text-field
          v-model="password"
          density="comfortable"
          label="Password"
          type="password"
        />

        <v-alert
          v-if="loginError"
          class="mb-4"
          density="compact"
          type="error"
          variant="tonal"
        >
          {{ loginError }}
        </v-alert>

        <v-btn
          block
          color="primary"
          :disabled="!server.trim() || !username.trim() || !password"
          :loading="loggingIn"
          type="submit"
        >
          Log in &amp; sync
        </v-btn>
      </v-form>
    </v-card-text>

    <v-card-text v-else>
      <div class="text-body-2 mb-1">
        Syncing as <strong>{{ sync.username }}</strong>
      </div>

      <div class="text-caption text-medium-emphasis mb-3">
        {{ sync.serverUrl }}<br>
        Last sync: {{ lastSyncText }}
      </div>

      <v-alert
        v-if="sync.error"
        class="mb-3"
        density="compact"
        type="warning"
        variant="tonal"
      >
        {{ sync.error }}
      </v-alert>

      <div class="d-flex ga-2">
        <v-btn
          color="primary"
          :loading="sync.syncing"
          variant="tonal"
          @click="doSync"
        >
          Sync now
        </v-btn>

        <v-btn variant="text" @click="doLogout">
          Log out
        </v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
  import { computed, ref } from 'vue'
  import { useAppStore } from '@/stores/app'
  import { DEFAULT_SERVER_URL, useSyncStore } from '@/stores/sync'
  import { formatTime } from '@/utils/format'

  const sync = useSyncStore()
  const app = useAppStore()

  const server = ref(DEFAULT_SERVER_URL)
  const username = ref('')
  const password = ref('')
  const loggingIn = ref(false)
  const loginError = ref('')

  const lastSyncText = computed(() =>
    sync.lastSyncAt ? formatTime(sync.lastSyncAt) : 'never',
  )

  async function doLogin () {
    loggingIn.value = true
    loginError.value = ''
    try {
      await sync.login(server.value, username.value, password.value)
      password.value = ''
      app.showSnackbar('Sync enabled')
    } catch (error) {
      loginError.value = error instanceof Error ? error.message : String(error)
    } finally {
      loggingIn.value = false
    }
  }

  async function doSync () {
    const ok = await sync.syncNow()
    if (ok) {
      app.showSnackbar('Synced')
    } else if (!navigator.onLine) {
      app.showSnackbar('You are offline', 'warning')
    }
  }

  async function doLogout () {
    await sync.logout()
    app.showSnackbar('Sync disabled — data stays on this device')
  }
</script>
