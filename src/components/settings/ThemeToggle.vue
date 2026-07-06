<template>
  <v-card class="mb-4">
    <v-card-title>Appearance</v-card-title>

    <v-card-text>
      <v-switch
        color="primary"
        hide-details
        label="Dark mode"
        :model-value="app.darkMode"
        @update:model-value="app.toggleDarkMode()"
      />
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
  import { useAppStore } from '@/stores/app'

  const app = useAppStore()
</script>
