<template>
  <v-card class="mb-4">
    <v-card-title>Backup</v-card-title>

    <v-card-text>
      <div class="text-body-2 text-medium-emphasis mb-4">
        Save every workout to a JSON file you keep yourself, or restore one.
        Importing replaces the workouts on this device.
      </div>

      <div class="d-flex ga-2">
        <v-btn
          color="primary"
          prepend-icon="$download"
          variant="tonal"
          @click="doExport"
        >
          Export
        </v-btn>

        <v-btn
          prepend-icon="$upload"
          variant="tonal"
          @click="fileInput?.click()"
        >
          Import
        </v-btn>
      </div>

      <!-- The plain input does the file picking; the button above fronts it. -->
      <input
        ref="fileInput"
        accept="application/json,.json"
        class="d-none"
        type="file"
        @change="onFileChosen"
      >
    </v-card-text>
  </v-card>

  <v-dialog v-model="confirmImport" max-width="400">
    <v-card>
      <v-card-title>Import backup?</v-card-title>

      <v-card-text>
        This replaces the {{ sessions.visibleSessions.length }} workout(s) on this
        device with the {{ pending.length }} in the file. It cannot be undone.
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn @click="cancelImport">Cancel</v-btn>
        <v-btn color="error" :loading="importing" @click="doImport">Import</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { Session } from '@/types/workout'
  import { ref, useTemplateRef } from 'vue'
  import { backupFileName, buildBackup, parseBackup } from '@/services/backup'
  import { useAppStore } from '@/stores/app'
  import { useSessionsStore } from '@/stores/sessions'
  import { errorMessage } from '@/utils/error'

  const sessions = useSessionsStore()
  const app = useAppStore()

  const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
  const confirmImport = ref(false)
  const importing = ref(false)
  /** Sessions read from the chosen file, held while the user confirms. */
  const pending = ref<Session[]>([])

  async function doExport () {
    // Settings is reachable directly on a cold start, so the sessions may not
    // have been read yet.
    await sessions.load()
    // Tombstones are sync bookkeeping, not workouts — they would only show up
    // as junk in a file the user is meant to be able to read.
    const backup = buildBackup(sessions.visibleSessions)
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = backupFileName()
    link.click()
    URL.revokeObjectURL(url)
    app.showSnackbar(`Exported ${backup.sessions.length} workout(s)`)
  }

  /**
   * Parses before asking for confirmation, so a file that turns out to be
   * unreadable is reported without the user first agreeing to lose their data.
   */
  async function onFileChosen (event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    // Picking the same file twice in a row fires no change event unless the
    // value is cleared, and the read is already done by then either way.
    input.value = ''
    if (!file) {
      return
    }
    try {
      await sessions.load()
      pending.value = parseBackup(await file.text())
      confirmImport.value = true
    } catch (error) {
      app.showSnackbar(`Import failed: ${errorMessage(error)}`, 'error')
    }
  }

  async function doImport () {
    importing.value = true
    try {
      await sessions.importSessions(pending.value)
      app.showSnackbar(`Imported ${pending.value.length} workout(s)`)
      confirmImport.value = false
      pending.value = []
    } catch (error) {
      app.showSnackbar(`Import failed: ${errorMessage(error)}`, 'error')
    } finally {
      importing.value = false
    }
  }

  function cancelImport () {
    confirmImport.value = false
    pending.value = []
  }
</script>
