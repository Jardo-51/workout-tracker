<template>
  <v-container>
    <h1 class="mb-4">Settings</h1>
    <ThemeToggle />
    <WeightUnitSetting />
  </v-container>
</template>

<script lang="ts" setup>
  import ThemeToggle from '@/components/settings/ThemeToggle.vue'
  import WeightUnitSetting from '@/components/settings/WeightUnitSetting.vue'
</script>
