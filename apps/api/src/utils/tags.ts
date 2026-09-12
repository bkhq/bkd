/** Parse JSON-encoded tags from DB text column into string array. */
export function parseTags(raw: string | null | undefined): string[] | null {
  if (!raw) return null
  let candidates: string[]
  try {
    const parsed = JSON.parse(raw)
    candidates = Array.isArray(parsed) ? parsed : [raw]
  } catch {
    candidates = [raw]
  }
  const valid = candidates.filter(
    (s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 50,
  )
  return valid.length > 0 ? valid : null
}

/** Serialize tags array to JSON string for DB storage, or null if empty. */
export function serializeTags(tags: string[] | null | undefined): string | null {
  if (!tags || tags.length === 0) return null
  return JSON.stringify(tags)
}

/**
 * Trim, collapse internal whitespace, and drop case-insensitive duplicates
 * (keeping the first-seen casing). Free-form tag input has no registry, so this
 * is the only thing preventing `web`, `Web` and `web ` from becoming three tags.
 */
export function normalizeTags(tags: string[] | null | undefined): string[] | null {
  if (!tags) return null
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ')
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(tag)
  }
  return result.length > 0 ? result : null
}
