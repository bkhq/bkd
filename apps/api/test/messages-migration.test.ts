/**
 * Upgrading a database at 0028 moves decision events and their Telegram
 * message mapping into `messages` without losing a field.
 */
import { Database } from 'bun:sqlite'
import { afterAll, describe, expect, test } from 'bun:test'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { resolveMigrationsDir } from '@/db/migrations-source'

const workDir = mkdtempSync(resolve(tmpdir(), 'bkd-messages-migration-'))

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

/** A copy of the migrations folder whose journal stops at `lastTag`. */
function migrationsUpTo(lastTag: string): string {
  const source = resolveMigrationsDir().dir
  const dir = resolve(workDir, lastTag)
  cpSync(source, dir, { recursive: true })
  const journalPath = resolve(dir, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] }
  const end = journal.entries.findIndex(e => e.tag === lastTag)
  journal.entries = journal.entries.slice(0, end + 1)
  writeFileSync(journalPath, JSON.stringify(journal))
  return dir
}

function apply(sqlite: Database, folder: string) {
  sqlite.run('PRAGMA foreign_keys = OFF')
  migrate(drizzle({ client: sqlite }), { migrationsFolder: folder })
  sqlite.run('PRAGMA foreign_keys = ON')
}

describe('0029-0031 messages migration', () => {
  test('copies decision events, channel messages and the cleanup job', () => {
    const sqlite = new Database(resolve(workDir, 'upgrade.db'))
    apply(sqlite, migrationsUpTo('0028_issues_logs_fts'))

    const notify = JSON.stringify({ type: 'bkd-follow-up', bkdUrl: 'http://bkd', projectId: 'p1', issueId: 'i1' })
    sqlite.run(
      `INSERT INTO decision_events (id, status, campaign_id, ref, question, context, options, recommendation,
         blocks, continues, notify, decision, outcome, withdraw_reason, close_reason, notified_at,
         created_at, updated_at, is_deleted)
       VALUES ('ev000001', 'decided', 'camp', 'i2', 'Merge?', 'ctx', '[{"id":"A","label":"a","impact":""}]',
         '{"optionId":"A","reason":""}', 'b', 'c', ?, '{"optionId":"A","instruction":"","decidedBy":"user","decidedAt":"x"}',
         NULL, NULL, NULL, 1700000100, 1700000000, 1700000200, 0)`,
      [notify],
    )
    sqlite.run(`INSERT INTO webhooks (id, channel, url, secret, events, is_active, interactive, created_at, updated_at, is_deleted)
                VALUES ('wh1', 'telegram', '-100', 't', '[]', 1, 1, 0, 0, 0)`)
    sqlite.run(`INSERT INTO decision_channel_messages (id, webhook_id, event_id, chat_id, message_id, created_at, updated_at, is_deleted)
                VALUES ('cm1', 'wh1', 'ev000001', '-100', 77, 0, 0, 0)`)
    sqlite.run(`INSERT INTO cron_jobs (id, name, cron, task_type, task_config, enabled, created_at, updated_at, is_deleted)
                VALUES ('job1', 'decision-event-cleanup', '0 0 5 * * *', 'builtin', '{"action":"decision-event-cleanup"}', 1, 0, 0, 0)`)

    apply(sqlite, resolveMigrationsDir().dir)

    expect(sqlite.query('SELECT * FROM messages').all()).toEqual([{
      id: 'ev000001',
      kind: 'decision',
      expects: 'reply',
      status: 'decided',
      level: 'info',
      campaign_id: 'camp',
      source: notify,
      ref: 'i2',
      title: 'Merge?',
      body: 'ctx',
      options: '[{"id":"A","label":"a","impact":""}]',
      recommendation: '{"optionId":"A","reason":""}',
      blocks: 'b',
      continues: 'c',
      decision: '{"optionId":"A","instruction":"","decidedBy":"user","decidedAt":"x"}',
      reply: null,
      outcome: null,
      withdraw_reason: null,
      close_reason: null,
      notified_at: 1700000100,
      created_at: 1700000000,
      updated_at: 1700000200,
      is_deleted: 0,
    }])
    expect(sqlite.query('SELECT webhook_id, message_id, chat_id, chat_message_id FROM message_channel_messages').all())
      .toEqual([{ webhook_id: 'wh1', message_id: 'ev000001', chat_id: '-100', chat_message_id: 77 }])
    expect(sqlite.query('SELECT name, task_config FROM cron_jobs').all())
      .toEqual([{ name: 'message-cleanup', task_config: '{"action":"message-cleanup"}' }])
    const tables = sqlite.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'decision%'`).all()
    expect(tables).toEqual([])
    sqlite.close()
  })
})
