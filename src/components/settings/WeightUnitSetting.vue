<template>
  <v-card class="mb-4">
    <v-card-title>Units</v-card-title>

    <v-card-text>
      <v-btn-toggle
        color="primary"
        divided
        mandatory
        :model-value="app.weightUnit"
        variant="outlined"
        @update:model-value="app.setWeightUnit($event)"
      >
        <v-btn value="kg">kg</v-btn>
        <v-btn value="lbs">lbs</v-btn>
      </v-btn-toggle>

      <div class="text-caption text-medium-emphasis mt-2">
        Applies to new entries; logged weights keep their unit.
      </div>
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
  import { useAppStore } from '@/stores/app'

  const app = useAppStore()
</script>
