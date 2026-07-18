import type { WeightUnit } from '@/types/workout'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  const snackbar = ref(false)
  const snackbarText = ref('')
  const snackbarColor = ref('success')
  const snackbarAction = ref<{ label: string, handler: () => void } | null>(null)
  const darkMode = ref(localStorage.getItem('darkMode') === 'true')
  const weightUnit = ref<WeightUnit>(localStorage.getItem('weightUnit') === 'lbs' ? 'lbs' : 'kg')

  function showSnackbar (
    text: string,
    color = 'success',
    action: { label: string, handler: () => void } | null = null,
  ) {
    snackbarText.value = text
    snackbarColor.value = color
    snackbarAction.value = action
    snackbar.value = true
  }

  function toggleDarkMode () {
    darkMode.value = !darkMode.value
    localStorage.setItem('darkMode', String(darkMode.value))
  }

  function setWeightUnit (unit: WeightUnit) {
    weightUnit.value = unit
    localStorage.setItem('weightUnit', unit)
  }

  return {
    snackbar,
    snackbarText,
    snackbarColor,
    snackbarAction,
    darkMode,
    weightUnit,
    showSnackbar,
    toggleDarkMode,
    setWeightUnit,
  }
})
