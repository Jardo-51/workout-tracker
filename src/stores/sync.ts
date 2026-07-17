import type { Account } from '@/services/etesync'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { withSyncLock } from '@/services/broadcast'
import { clearSyncState } from '@/services/db'
import { useSessionsStore } from '@/stores/sessions'

/** Default server used by official Etesync 2.0 accounts. */
export const DEFAULT_SERVER_URL = 'https://api.etebase.com/partner/etesync/'

const LS_SESSION = 'etesync.session'
const LS_USERNAME = 'etesync.username'
const LS_SERVER = 'etesync.serverUrl'
const LS_LAST_SYNC = 'etesync.lastSyncAt'

const SYNC_DEBOUNCE_MS = 4000

// The etebase Account holds crypto state; keep it out of Vue reactivity.
let account: Account | undefined

/** Lazy-loaded so the etebase bundle is only fetched once sync is used. */
function etesync () {
  return import('@/services/etesync')
}

export const useSyncStore = defineStore('sync', () => {
  const sessionsStore = useSessionsStore()

  const savedSession = ref(localStorage.getItem(LS_SESSION))
  const username = ref(localStorage.getItem(LS_USERNAME) ?? '')
  const serverUrl = ref(localStorage.getItem(LS_SERVER) ?? '')
  const lastSyncAt = ref(Number(localStorage.getItem(LS_LAST_SYNC)) || undefined)
  const syncing = ref(false)
  const error = ref('')

  const configured = computed(() => savedSession.value !== null)

  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let syncQueued = false
  let initialized = false

  function init () {
    if (initialized) {
      return
    }
    initialized = true
    watch(() => sessionsStore.mutationCount, () => requestSync())
    window.addEventListener('online', () => requestSync(0))
    if (configured.value) {
      syncNow()
    }
  }

  async function login (server: string, user: string, password: string) {
    const api = await etesync()
    const result = await api.login(user.trim(), password, server.trim())
    account = result.account
    savedSession.value = result.savedSession
    username.value = user.trim()
    serverUrl.value = server.trim()
    error.value = ''
    localStorage.setItem(LS_SESSION, result.savedSession)
    localStorage.setItem(LS_USERNAME, username.value)
    localStorage.setItem(LS_SERVER, serverUrl.value)
    await syncNow()
  }

  async function logout () {
    const current = account
    account = undefined
    savedSession.value = null
    username.value = ''
    serverUrl.value = ''
    lastSyncAt.value = undefined
    error.value = ''
    localStorage.removeItem(LS_SESSION)
    localStorage.removeItem(LS_USERNAME)
    localStorage.removeItem(LS_SERVER)
    localStorage.removeItem(LS_LAST_SYNC)
    await clearSyncState()
    if (current) {
      const api = await etesync()
      await api.logout(current)
    }
  }

  /** Debounced sync — batches rapid mutations into one run. */
  function requestSync (delayMs: number = SYNC_DEBOUNCE_MS) {
    if (!configured.value) {
      return
    }
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => syncNow(), delayMs)
  }

  async function syncNow (): Promise<boolean> {
    if (!configured.value || !navigator.onLine) {
      return false
    }
    if (syncing.value) {
      syncQueued = true
      return false
    }
    syncing.value = true
    try {
      const api = await etesync()
      account ??= await api.restoreAccount(savedSession.value!)
      const account_ = account
      const ran = await withSyncLock(() =>
        api.syncSessions(account_, sessionsStore.sessions, sessionsStore.upsertFromRemote),
      )
      if (!ran) {
        // Another tab is syncing the same account; its results reach us over
        // the broadcast channel.
        return false
      }
      lastSyncAt.value = Date.now()
      localStorage.setItem(LS_LAST_SYNC, String(lastSyncAt.value))
      error.value = ''
      return true
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_)
      return false
    } finally {
      syncing.value = false
      if (syncQueued) {
        syncQueued = false
        requestSync()
      }
    }
  }

  return {
    configured,
    username,
    serverUrl,
    syncing,
    lastSyncAt,
    error,
    init,
    login,
    logout,
    requestSync,
    syncNow,
  }
})
