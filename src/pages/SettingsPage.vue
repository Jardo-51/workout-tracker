<template>
  <v-container>
    <h1 class="mb-4">Settings</h1>
    <ThemeToggle />
    <WeightUnitSetting />
    <EtesyncSettings />
    <DataManagement />
  </v-container>
</template>

<script lang="ts" setup>
  import DataManagement from '@/components/settings/DataManagement.vue'
  import EtesyncSettings from '@/components/settings/EtesyncSettings.vue'
  import ThemeToggle from '@/components/settings/ThemeToggle.vue'
  import WeightUnitSetting from '@/components/settings/WeightUnitSetting.vue'
</script>
