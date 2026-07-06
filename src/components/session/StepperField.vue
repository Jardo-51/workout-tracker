<template>
  <div class="d-flex align-center ga-2 mb-3">
    <v-btn
      :disabled="model - step < min"
      icon="mdi-minus"
      variant="tonal"
      @click="model = round(model - step)"
    />

    <v-text-field
      density="comfortable"
      hide-details
      :inputmode="decimal ? 'decimal' : 'numeric'"
      :label="label"
      :model-value="text"
      :suffix="suffix"
      @update:model-value="onInput"
    >
      <template v-if="$slots['append-inner']" #append-inner>
        <slot name="append-inner" />
      </template>
    </v-text-field>

    <v-btn
      icon="mdi-plus"
      variant="tonal"
      @click="model = round(model + step)"
    />
  </div>
</template>

<script lang="ts" setup>
  import { ref, watch } from 'vue'

  const props = withDefaults(defineProps<{
    label: string
    step?: number
    min?: number
    decimal?: boolean
    suffix?: string
  }>(), {
    step: 1,
    min: 0,
    decimal: false,
    suffix: undefined,
  })

  const model = defineModel<number>({ required: true })

  const text = ref(String(model.value))

  watch(model, value => {
    if (Number.parseFloat(text.value) !== value) {
      text.value = String(value)
    }
  })

  function round (value: number): number {
    return Math.max(props.min, Math.round(value * 100) / 100)
  }

  function onInput (value: string) {
    text.value = value
    const parsed = props.decimal
      ? Number.parseFloat(value.replace(',', '.'))
      : Number.parseInt(value, 10)
    if (!Number.isNaN(parsed) && parsed >= props.min) {
      model.value = parsed
    }
  }
</script>
