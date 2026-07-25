const CHANNEL_NAME = 'workout-tracker'
const SYNC_LOCK = 'workout-tracker.sync'

interface SessionChangedMessage {
  type: 'session-changed'
  sessionId: string
}

interface DataReplacedMessage {
  type: 'data-replaced'
}

type Message = SessionChangedMessage | DataReplacedMessage

let channel: BroadcastChannel | undefined

function getChannel (): BroadcastChannel | undefined {
  if (!channel && 'BroadcastChannel' in globalThis) {
    channel = new BroadcastChannel(CHANNEL_NAME)
  }
  return channel
}

/** Tells other tabs that this session's stored copy changed. */
export function broadcastSessionChanged (sessionId: string): void {
  getChannel()?.postMessage({ type: 'session-changed', sessionId } satisfies Message)
}

/**
 * Tells other tabs that every session was swapped out at once (backup import).
 * Sent instead of a per-session message because sessions the import *removed*
 * have no id a peer could learn about, and a peer still holding one in memory
 * would write it back on its next mutation.
 */
export function broadcastDataReplaced (): void {
  getChannel()?.postMessage({ type: 'data-replaced' } satisfies Message)
}

/** Fires for changes made by *other* tabs; a tab never hears its own messages. */
export function onSessionChanged (handler: (sessionId: string) => void): void {
  onMessage(message => {
    if (message.type === 'session-changed') {
      handler(message.sessionId)
    }
  })
}

/** As above, for a wholesale replacement of the stored sessions. */
export function onDataReplaced (handler: () => void): void {
  onMessage(message => {
    if (message.type === 'data-replaced') {
      handler()
    }
  })
}

function onMessage (handler: (message: Message) => void): void {
  getChannel()?.addEventListener('message', event => {
    const message = event.data as Message | undefined
    if (message) {
      handler(message)
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
