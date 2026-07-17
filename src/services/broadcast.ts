const CHANNEL_NAME = 'workout-tracker'
const SYNC_LOCK = 'workout-tracker.sync'

interface SessionChangedMessage {
  type: 'session-changed'
  sessionId: string
}

let channel: BroadcastChannel | undefined

function getChannel (): BroadcastChannel | undefined {
  if (!channel && 'BroadcastChannel' in globalThis) {
    channel = new BroadcastChannel(CHANNEL_NAME)
  }
  return channel
}

/** Tells other tabs that this session's stored copy changed. */
export function broadcastSessionChanged (sessionId: string): void {
  getChannel()?.postMessage({ type: 'session-changed', sessionId } satisfies SessionChangedMessage)
}

/** Fires for changes made by *other* tabs; a tab never hears its own messages. */
export function onSessionChanged (handler: (sessionId: string) => void): void {
  getChannel()?.addEventListener('message', event => {
    const message = event.data as SessionChangedMessage | undefined
    if (message?.type === 'session-changed') {
      handler(message.sessionId)
    }
  })
}

/**
 * Runs `job` only if no other tab is syncing, since a concurrent run would
 * race the shared stoken/syncMeta bookkeeping and can create duplicate server
 * items. Returns undefined when another tab holds the lock — the local state
 * lands via `onSessionChanged` once that tab finishes.
 */
export async function withSyncLock<T> (job: () => Promise<T>): Promise<T | undefined> {
  if (!navigator.locks) {
    return job()
  }
  return navigator.locks.request(
    SYNC_LOCK,
    { ifAvailable: true },
    async lock => (lock ? job() : undefined),
  )
}
