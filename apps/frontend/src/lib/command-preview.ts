export interface CommandPreview {
  summary: string
  isTruncated: boolean
}

/** The command on one line, for summaries that truncate by width in CSS. */
export function compactCommand(command: string): string {
  return command.replace(/\s+/g, ' ').trim()
}

export function getCommandPreview(command: string, maxChars = 90): CommandPreview {
  const compact = compactCommand(command)
  if (!compact) {
    return { summary: '', isTruncated: false }
  }
  const isTruncated = compact.length > maxChars
  const clipped = isTruncated ? compact.slice(0, maxChars).trimEnd() : compact

  return {
    summary: isTruncated ? `${clipped} .....` : clipped,
    isTruncated,
  }
}
