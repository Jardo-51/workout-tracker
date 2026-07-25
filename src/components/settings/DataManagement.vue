<template>
  <v-card class="mb-4">
    <v-card-title>Backup</v-card-title>

    <v-card-text>
      <div class="text-body-2 text-medium-emphasis mb-4">
        Save every workout to a JSON file you keep yourself, or restore one.
        Importing merges the file into this device: what it has is added, and
        what only this device has is left alone.
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

      <v-btn
        block
        class="mt-4"
        color="error"
        :disabled="workoutCount === 0"
        prepend-icon="$deleteOutline"
        variant="text"
        @click="confirmClear = true"
      >
        Clear all workouts
      </v-btn>
    </v-card-text>
  </v-card>

  <v-dialog v-model="confirmImport" max-width="400">
    <v-card>
      <v-card-title>Import backup?</v-card-title>

      <v-card-text>
        This adds the {{ pendingWorkouts }} workout(s) in the file to the
        {{ workoutCount }} already here. One you already have is overwritten
        where the file's copy is newer, and one you deleted before the file was
        written is deleted here too.

        <template v-if="sync.configured">
          They reach your other devices on the next sync.
        </template>

        <template v-if="workoutCount > 0">
          To restore the file and nothing else, clear the workouts first.
        </template>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn @click="cancelImport">Cancel</v-btn>
        <v-btn color="primary" :loading="importing" @click="doImport">Import</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="confirmClear" max-width="400">
    <v-card>
      <v-card-title>Clear all workouts?</v-card-title>

      <v-card-text>
        This deletes all {{ workoutCount }} workout(s) and their entries.
        <template v-if="sync.configured">
          They go from the sync server and your other devices too. To clear
          only this device and keep the copy on the server, log out under
          Etesync sync above first.
        </template>

        <template v-else>
          Nothing is left behind on this device.
        </template>
        It cannot be undone — export first if you want to keep a copy.
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn @click="confirmClear = false">Cancel</v-btn>
        <v-btn color="error" :loading="clearing" @click="doClear">Delete everything</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { Session } from '@/types/workout'
  import { computed, onMounted, ref, useTemplateRef } from 'vue'
  import { backupFileName, buildBackup, parseBackup } from '@/services/backup'
  import { useAppStore } from '@/stores/app'
  import { useSessionsStore } from '@/stores/sessions'
  import { useSyncStore } from '@/stores/sync'
  import { errorMessage } from '@/utils/error'

  const sessions = useSessionsStore()
  const sync = useSyncStore()
  const app = useAppStore()

  const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
  const confirmImport = ref(false)
  const importing = ref(false)
  const confirmClear = ref(false)
  const clearing = ref(false)
  /** Sessions read from the chosen file, held while the user confirms. */
  const pending = ref<Session[]>([])

  const workoutCount = computed(() => sessions.visibleSessions.length)
  /** The file's workouts; it also carries tombstones, which are not workouts. */
  const pendingWorkouts = computed(() => pending.value.filter(s => !s.deleted).length)

  // Settings is reachable directly on a cold start, so the sessions may not
  // have been read yet — the counts and the Clear button need them.
  onMounted(() => void sessions.load())

  async function doExport () {
    // Guards the click that beats the load kicked off on mount.
    await sessions.load()
    // Tombstones go in the file too, so it is the whole of what this device
    // holds rather than only the part of it a human would want to read. They
    // are what carries a deletion: a device that still has a workout this one
    // deleted before the export drops it on import, the same way it would have
    // over sync. Leaving them out would make the file quietly weaker than the
    // state it claims to be a copy of. The count below stays about workouts.
    const backup = buildBackup(sessions.sessions)
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = backupFileName()
    // In the document because some engines ignore a click on a detached
    // anchor, and the revoke deferred because only Chrome reliably starts the
    // fetch during the click itself — revoking synchronously cancels the
    // download elsewhere, and the snackbar below would then report a file that
    // was never written.
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    app.showSnackbar(`Exported ${workoutCount.value} workout(s)`)
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
    const total = pendingWorkouts.value
    try {
      const applied = await sessions.importSessions(pending.value)
      // A session the file has an older copy of is skipped, so saying the file
      // was imported in full would be a lie the user could later trip over.
      app.showSnackbar(applied === total
        ? `Imported ${total} workout(s)`
        : `Imported ${applied} of ${total} workout(s) — the rest were already here`)
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

  async function doClear () {
    clearing.value = true
    const count = workoutCount.value
    try {
      // Logged in, the clear is meant to reach the account; logged out, it is
      // meant to leave nothing here that a later login could push.
      await sessions.clearAllSessions(sync.configured)
      app.showSnackbar(`Deleted ${count} workout(s)`)
      confirmClear.value = false
    } catch (error) {
      app.showSnackbar(`Could not clear data: ${errorMessage(error)}`, 'error')
    } finally {
      clearing.value = false
    }
  }
</script>
