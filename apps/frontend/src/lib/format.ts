/** Compact byte size: 500 → "500B", 2560 → "2.5KB", 1.5e9 → "1.4GB" */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}MB`
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`
}

/** Locale date + time, tolerant of a missing value. */
export function formatDateTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-'
  const date = new Date(typeof value === 'number' ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
}

/** Duration in milliseconds: 500 → "500ms", 1500 → "1.5s", 90000 → "1m30s" */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '-'
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${Math.round(seconds % 60)}s`
}

/** Time elapsed since a timestamp: "45s", "3m 12s", "2h 5m" */
export function formatElapsed(timestamp: string | null | undefined): string {
  if (!timestamp) return ''
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/** Turn a raw model ID like "claude-opus-4-6" into a shorter display name */
export function formatModelName(id: string): string {
  const m = id.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(\[.*\])?$/)
  if (m) {
    const suffix = m[4] || ''
    return `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}${suffix}`
  }
  return id
}

/** Format a token count compactly: 999 → "999", 12345 → "12.3k", 2560000 → "2.6M" */
export function formatTokenCount(count: number): string {
  if (count < 1000) return `${count}`
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`
  return `${(count / 1_000_000).toFixed(1)}M`
}

export function getProjectInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '??'
  const words = trimmed.split(/\s+/)
  if (words.length >= 2) {
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase()
  }
  return trimmed.slice(0, 2).toUpperCase()
}
