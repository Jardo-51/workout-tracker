import type { Tempo } from '@/types/workout'

/** Local calendar date as 'YYYY-MM-DD'. */
export function toDateKey (epochMs: number): string {
  const d = new Date(epochMs)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatDateKey (dateKey: string): string {
  const [y = 1970, m = 1, d = 1] = dateKey.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(y, m - 1, d))
}

export function formatTime (epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(epochMs))
}

export function formatTempo (tempo: Tempo): string {
  return tempo.join('-')
}

export function formatDuration (sec: number): string {
  if (sec < 60) {
    return `${sec} s`
  }
  const min = Math.floor(sec / 60)
  const rest = sec % 60
  return rest === 0 ? `${min} min` : `${min} min ${rest} s`
}
