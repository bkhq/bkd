/**
 * Whiteboard-specific prompt builders.
 *
 * The whiteboard AI is a mindmap assistant. Instead of returning structured
 * markdown for the server to parse, it operates directly on the whiteboard
 * via MCP tools (whiteboard-get-tree / whiteboard-add-node / whiteboard-update-node /
 * whiteboard-delete-node / whiteboard-move-node).
 *
 * Two prompt shapes:
 *  - System prompt (sent once at session start): rules of engagement + tool reference
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
    'You have access to 5 MCP tools that mutate the whiteboard directly. Prefer these over',
    'writing structured output that the server must parse.',
    '',
    '  whiteboard-get-tree     — Fetch the current tree. Call this first whenever you need',
    '                            fresh IDs or structure (the snapshot in the turn prompt may',
    '                            already be stale after your own edits).',
    '  whiteboard-add-node     — Append a child under parentId. Use for expand/explore tasks.',
    '  whiteboard-update-node  — Change label/content/icon of an existing node. Use for',
    '                            explain/rewrite/simplify tasks.',
    '  whiteboard-delete-node  — Remove a node and its subtree. Use sparingly — confirm intent.',
    '  whiteboard-move-node    — Re-parent or reorder. Use for restructuring.',
    '',
    `Always pass projectId="${projectId}" when calling whiteboard-* tools.`,
    '',
    'Working style:',
    '- When the user asks you to expand/explore a node, create 3-7 children via whiteboard-add-node.',
    '- When the user asks you to explain/rewrite a node\'s body, use whiteboard-update-node on',
    '  that node\'s content field.',
    '- Keep node labels short (under ~60 chars). Put detail in content.',
    '- After mutations, give the user a brief one-line summary of what you changed.',
    '- If the user asks a question that doesn\'t require mutation (e.g. "what does this mean?"),',
    '  just answer in chat — do not create nodes.',
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
