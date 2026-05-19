import { describe, expect, test } from 'bun:test'
import { buildCockpitSystemPrompt } from '@/routes/cockpit/prompt'
import './setup'

describe('buildCockpitSystemPrompt', () => {
  test('includes the server name in the persona line', () => {
    const out = buildCockpitSystemPrompt('my-bkd.local')
    expect(out).toContain('my-bkd.local')
    expect(out.toLowerCase()).toContain('cockpit')
  })

  test('lists all five read-only tools', () => {
    const out = buildCockpitSystemPrompt('any')
    for (const name of [
      'cockpit_get_stats',
      'cockpit_list_issues',
      'cockpit_get_issue',
      'cockpit_recent_activity',
      'cockpit_search_logs',
    ]) {
      expect(out).toContain(name)
    }
  })

  test('lists the cockpit_propose_action mutation gate', () => {
    const out = buildCockpitSystemPrompt('any')
    expect(out).toContain('cockpit_propose_action')
    for (const t of ['cancel_issue', 'restart_issue', 'bulk_update_status', 'create_issue']) {
      expect(out).toContain(t)
    }
  })

  test('instructs the AI never to claim it acted directly', () => {
    const out = buildCockpitSystemPrompt('any')
    // The exact wording forbids "claim to have ...". Verify the intent words.
    expect(out.toLowerCase()).toContain('propose')
    expect(out.toLowerCase()).toMatch(/never|cannot|do not/i)
  })
})
