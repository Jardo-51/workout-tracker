<template>
  <div class="d-flex align-center ga-2 mb-3">
    <v-btn
      :disabled="model <= min"
      icon="$minus"
      variant="tonal"
      @click="commit(round(model - step))"
    />

    <v-text-field
      density="comfortable"
      :error="invalid"
      hide-details
      :inputmode="decimal ? 'decimal' : 'numeric'"
      :label="label"
      :model-value="text"
      :suffix="suffix"
      @blur="onBlur"
      @update:model-value="onInput"
    >
      <template v-if="$slots['append-inner']" #append-inner>
        <slot name="append-inner" />
      </template>
    </v-text-field>

    <v-btn
      icon="$plus"
      variant="tonal"
      @click="commit(round(model + step))"
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

  /** True while the field shows text that does not parse to a usable number. */
  const invalid = defineModel<boolean>('invalid', { default: false })

  const text = ref(String(model.value))

  watch(model, value => {
    if (parse(text.value) !== value) {
      text.value = String(value)
      invalid.value = false
    }
  })

  function parse (value: string): number {
    const normalized = value.trim().replace(',', '.')
    if (normalized === '') {
      return Number.NaN
    }
    const parsed = Number(normalized)
    return Number.isFinite(parsed) && (props.decimal || Number.isInteger(parsed))
      ? parsed
      : Number.NaN
  }

  function round (value: number): number {
    return Math.max(props.min, Math.round(value * 100) / 100)
  }

  function commit (value: number) {
    model.value = value
    text.value = String(value)
    invalid.value = false
  }

  function onInput (value: string) {
    text.value = value
    const parsed = parse(value)
    if (Number.isNaN(parsed) || parsed < props.min) {
      invalid.value = true
      return
    }
    invalid.value = false
    model.value = parsed
  }

  function onBlur () {
    if (invalid.value) {
      commit(model.value)
    }
  }
</script>
