/**
 * Whiteboard-specific prompt builders.
 *
 * The whiteboard AI is a mindmap assistant. It returns structured markdown
 * that the server parses (via /parse-response) to create child nodes.
 *
 * Two prompt shapes:
 *  - System prompt (sent once at session start): rules of engagement
 *  - Turn prompt (per request): tree snapshot + active node + user intent
 */

import type { whiteboardNodes } from '@/db/schema'

type WhiteboardRow = typeof whiteboardNodes.$inferSelect

/** Build the system prompt attached to the first turn of a whiteboard session. */
export function buildWhiteboardSystemPrompt(projectId: string, projectName: string): string {
  return [
    `You are a mindmap/whiteboard assistant for the project "${projectName}" (projectId: "${projectId}").`,
    'The user interacts with a tree-structured whiteboard. Each node has: id, parentId, label,',
    'content (free-form body, markdown allowed), icon (short emoji), and sortOrder.',
    '',
    'Output format:',
    '- When the user asks you to expand/explore a node, respond with 3-7 markdown "## headings".',
    '  Each heading becomes a new child node\'s label. The body under each heading becomes the',
    '  child\'s content. Keep headings short (under ~60 chars).',
    '- When the user asks a question that doesn\'t require mutation (e.g. "what does this mean?"),',
    '  just answer in chat — do not emit headings.',
  ].join('\n')
}

/**
 * Build the per-turn prompt: snapshot of the tree + active node focus + user intent.
 * The system prompt is only prepended on the first turn; subsequent turns only need
 * the fresh snapshot and the new user intent.
 */
export function buildWhiteboardTurnPrompt(options: {
  rows: WhiteboardRow[]
  activeNodeId?: string | null
  userPrompt: string
}): string {
  const { rows, activeNodeId, userPrompt } = options

  const snapshot = rows.map(r => ({
    id: r.id,
    parentId: r.parentId ?? null,
    label: r.label || '',
    icon: r.icon ?? '',
    sortOrder: r.sortOrder,
    // Truncate long content in the snapshot to keep the prompt compact;
    // the AI can call whiteboard-get-tree or read the full node if needed.
    content: r.content.length > 400 ? `${r.content.slice(0, 400)}…` : r.content,
  }))

  const activeNode = activeNodeId ? rows.find(r => r.id === activeNodeId) : null
  const focusLines: string[] = []
  if (activeNode) {
    // Build root→node path for human-readable context
    const byId = new Map(rows.map(r => [r.id, r]))
    const path: string[] = []
    const visited = new Set<string>()
    let current: WhiteboardRow | undefined = activeNode
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      path.unshift(current.label || 'Untitled')
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    focusLines.push(
      `Active node: id="${activeNode.id}" label="${activeNode.label}"`,
      `Active node path: ${path.join(' > ')}`,
    )
  } else {
    focusLines.push('Active node: (none — user is addressing the whole board)')
  }

  return [
    '## Whiteboard snapshot',
    '```json',
    JSON.stringify(snapshot, null, 2),
    '```',
    '',
    ...focusLines,
    '',
    '## User request',
    userPrompt,
  ].join('\n')
}
