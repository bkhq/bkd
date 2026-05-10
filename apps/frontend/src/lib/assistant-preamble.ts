/**
 * opencode/ACP engines instruct the model to emit a structured task-tracking
 * preamble (Goal / Constraints / Progress / Key Decisions / Next Steps /
 * Critical Context / Relevant Files) BEFORE the user-facing reply, all in a
 * single assistant message. To users this looks like "thinking content mixed
 * into the reply". This module detects and splits the preamble so the UI
 * can render it as a collapsible block above the actual reply.
 *
 * Detection is conservative: we ONLY split when we see a known opencode
 * preamble pattern (multiple of the standard sections, all leading the
 * content). Everything else stays untouched.
 */

const OPENCODE_PREAMBLE_HEADERS = [
  '## Goal',
  '## Constraints & Preferences',
  '## Progress',
  '## Key Decisions',
  '## Next Steps',
  '## Critical Context',
  '## Relevant Files',
]

export interface SplitAssistantContent {
  preamble: string | null
  reply: string
}

/**
 * Split an assistant message into (optional) opencode task-plan preamble +
 * actual reply. Returns `{ preamble: null, reply: full content }` when no
 * preamble is detected.
 */
export function splitAssistantPreamble(content: string): SplitAssistantContent {
  const trimmed = content.trimStart()
  // Cheap rejection: must start with one of the known preamble headers.
  if (!OPENCODE_PREAMBLE_HEADERS.some(h => trimmed.startsWith(h))) {
    return { preamble: null, reply: content }
  }

  // Walk top-level sections. A "section" is a block starting with `## `
  // (level-2 markdown header). The preamble ends at the first section whose
  // header is NOT in the known set.
  const lines = content.split('\n')
  const headerSet = new Set(OPENCODE_PREAMBLE_HEADERS)
  let lastPreambleLine = -1
  let inPreamble = true
  let knownSectionsSeen = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('## ')) continue
    const header = line.split('\n')[0]
    if (inPreamble && headerSet.has(header)) {
      lastPreambleLine = i
      knownSectionsSeen++
      continue
    }
    if (inPreamble) {
      // First non-preamble section — reply starts here.
      // Need at least 2 known preamble sections to consider it a real preamble
      // (1 header alone is too weak a signal).
      if (knownSectionsSeen < 2) {
        return { preamble: null, reply: content }
      }
      inPreamble = false
      // Find the line after the LAST preamble content (skip trailing blank
      // lines so the reply starts cleanly).
      let replyStart = i
      while (replyStart > 0 && lines[replyStart - 1].trim() === '') replyStart--
      return {
        preamble: lines.slice(0, replyStart).join('\n').trimEnd(),
        reply: lines.slice(i).join('\n').trimStart(),
      }
    }
  }

  // The whole content is preamble (no reply yet — model in mid-stream).
  if (knownSectionsSeen >= 2 && lastPreambleLine >= 0) {
    return { preamble: content.trimEnd(), reply: '' }
  }
  return { preamble: null, reply: content }
}
