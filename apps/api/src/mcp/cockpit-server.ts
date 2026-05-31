import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import * as z from 'zod'
import { appEvents } from '@/events'
import { proposalStore } from '@/cockpit/proposals'
import type { CockpitProposalType } from '@/cockpit/proposals'
import {
  cockpitGetIssue,
  cockpitGetStats,
  cockpitListIssues,
  cockpitRecentActivity,
  cockpitSearchLogs,
} from './cockpit-tools'
import {
  bkdCreateIssue,
  bkdLinkIssues,
  bkdListChildren,
  bkdNotifyRoom,
  bkdQueryIssue,
  bkdTriggerIssue,
} from './workspace-tools'

let cached: ReturnType<typeof createSdkMcpServer> | null = null

export function getCockpitMcpServer(): ReturnType<typeof createSdkMcpServer> {
  if (cached) return cached
  cached = createSdkMcpServer({
    name: 'bkd-cockpit',
    version: '0.1.0',
    tools: [
      tool(
        'cockpit_get_stats',
        'Return per-project issue counts grouped by status (todo, working, review, done). Use this to understand workload distribution across all projects.',
        {},
        async () => cockpitGetStats(),
      ),
      tool(
        'cockpit_list_issues',
        'List issues across all projects. Filter by statuses or projectId. Returns up to `limit` rows (default 50, max 500) ordered by recent status change.',
        {
          statuses: z.array(z.enum(['todo', 'working', 'review', 'done'])).optional(),
          projectId: z.string().optional(),
          limit: z.number().int().min(1).max(500).optional(),
        },
        async params => cockpitListIssues(params),
      ),
      tool(
        'cockpit_get_issue',
        'Fetch a single issue by id with full session metadata (engine, model, tokens, cost, prompt). Use when the user asks about a specific issue.',
        { issueId: z.string() },
        async params => cockpitGetIssue(params),
      ),
      tool(
        'cockpit_recent_activity',
        'Return the most recent visible log entries across all issues. Helps answer "what just happened?" and "what is currently running?".',
        { limit: z.number().int().min(1).max(200).optional() },
        async params => cockpitRecentActivity(params),
      ),
      tool(
        'cockpit_search_logs',
        'Full-text search across visible conversation logs across all projects. Supports multi-word queries with FTS5 ranking. Use when the user asks to find something specific in past conversation history.',
        {
          query: z.string().min(1).max(200),
          limit: z.number().int().min(1).max(200).optional(),
        },
        async params => cockpitSearchLogs(params),
      ),
      tool(
        'cockpit_propose_action',
        'Queue a mutation (cancel/restart/bulk status change/create issue) for the user to APPROVE or REJECT in the cockpit assistant panel. You CANNOT execute mutations directly; you can only propose. Always include a short, human-readable summary so the user understands what you want to do before approving.',
        {
          type: z.enum(['cancel_issue', 'restart_issue', 'bulk_update_status', 'create_issue']),
          summary: z.string().min(3).max(280),
          params: z.record(z.string(), z.unknown()),
        },
        async ({ type, summary, params }) => {
          const p = proposalStore.propose(type as CockpitProposalType, params as never, summary)
          appEvents.emit('cockpit-proposal', { proposalId: p.id, status: 'pending' })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                proposalId: p.id,
                status: 'pending',
                summary,
                hint: 'The user must approve this in the cockpit panel before it runs.',
              }),
            }],
          }
        },
      ),
      tool(
        'bkd_query_issue',
        'Query a single issue by ID and return its metadata (title, status, tokens, cost, etc). Use this before mutating or linking issues to verify they exist and gather context.',
        { issueId: z.string() },
        async params => bkdQueryIssue(params),
      ),
      tool(
        'bkd_trigger_issue',
        'Send a follow-up message to an existing issue, triggering the AI engine to continue working. The issue must have an engine type set and a previous session.',
        { issueId: z.string(), prompt: z.string() },
        async params => bkdTriggerIssue(params),
      ),
      tool(
        'bkd_list_children',
        'List child issues linked to a given parent issue. Returns an array of {id, title, statusId, sessionStatus}. Use to understand the sub-task tree.',
        { parentIssueId: z.string() },
        async params => bkdListChildren(params),
      ),
      tool(
        'bkd_create_issue',
        'Create a new issue directly via DB insert (bypasses the normal route). Returns the new issue id and title. Use for automated bulk creation or secretary-driven task generation.',
        {
          projectId: z.string(),
          title: z.string(),
          prompt: z.string().optional(),
          parentIssueId: z.string().optional(),
        },
        async params => bkdCreateIssue(params),
      ),
      tool(
        'bkd_link_issues',
        'Set a parent-child relationship between two issues by updating the child\'s parentIssueId. Both issues must already exist.',
        { childIssueId: z.string(), parentIssueId: z.string() },
        async params => bkdLinkIssues(params),
      ),
      tool(
        'bkd_notify_room',
        'Push a message to a room (e.g. cockpit assistant panel). The message will appear in the target room for the user to see. Use for status updates, summaries, or alerts.',
        { roomType: z.string(), message: z.string() },
        async params => bkdNotifyRoom(params),
      ),
    ],
  })
  return cached
}
