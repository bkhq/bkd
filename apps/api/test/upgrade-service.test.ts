import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  getUpgradeStatus,
  getVersionInfo,
  reportReady,
  requestRestart,
  requestRollback,
  requestUpgrade,
} from '@/upgrade/service'

/**
 * The service only reads/writes lode's state.json, so a temp dir plus the
 * LODE_* env vars lode injects is a faithful stand-in for a live supervisor.
 */
let lodeDir: string
const savedEnv = {
  dir: process.env.LODE_DIR,
  instance: process.env.LODE_INSTANCE,
  version: process.env.LODE_ACTIVE_VERSION,
}

function writeState(state: Record<string, unknown>) {
  writeFileSync(resolve(lodeDir, 'state.json'), JSON.stringify(state))
}

function readState(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(lodeDir, 'state.json'), 'utf8'))
}

function supervise() {
  process.env.LODE_DIR = lodeDir
  process.env.LODE_INSTANCE = '4242-abc'
  process.env.LODE_ACTIVE_VERSION = '0.0.6'
}

beforeEach(() => {
  lodeDir = mkdtempSync(resolve(tmpdir(), 'bkd-lode-'))
  delete process.env.LODE_DIR
  delete process.env.LODE_INSTANCE
  delete process.env.LODE_ACTIVE_VERSION
})

afterEach(() => {
  rmSync(lodeDir, { recursive: true, force: true })
  for (const [key, value] of [
    ['LODE_DIR', savedEnv.dir],
    ['LODE_INSTANCE', savedEnv.instance],
    ['LODE_ACTIVE_VERSION', savedEnv.version],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('upgrade service — unsupervised', () => {
  it('reports an empty, unsupervised status', () => {
    const status = getUpgradeStatus()

    expect(status.supervised).toBe(false)
    expect(status.status).toBeNull()
    expect(status.hasUpdate).toBe(false)
    expect(status.history).toEqual([])
  })

  it('reports version info without a supervisor', () => {
    const info = getVersionInfo()

    expect(info.supervised).toBe(false)
    expect(info.activeVersion).toBeNull()
    expect(typeof info.version).toBe('string')
  })

  it('refuses every mutating request', () => {
    expect(() => requestUpgrade()).toThrow(/Not running under lode/)
    expect(() => requestRollback()).toThrow(/Not running under lode/)
    expect(() => requestRestart()).toThrow(/Not running under lode/)
  })

  it('makes readiness reporting a no-op', () => {
    expect(() => reportReady()).not.toThrow()
  })
})

describe('upgrade service — supervised', () => {
  beforeEach(supervise)

  it('maps lode state onto the status payload', () => {
    writeState({
      current: '0.0.6',
      last_good: '0.0.5',
      available: '0.0.7',
      status: 'running',
      last_check: '2026-08-24T00:00:00.000Z',
      last_error: null,
      history: [{ version: '0.0.6', at: '2026-08-24T00:00:00.000Z', result: 'good' }],
    })

    const status = getUpgradeStatus()

    expect(status).toMatchObject({
      supervised: true,
      status: 'running',
      current: '0.0.6',
      lastGood: '0.0.5',
      available: '0.0.7',
      hasUpdate: true,
      lastCheck: '2026-08-24T00:00:00.000Z',
      lastError: null,
      target: null,
    })
    expect(status.history).toHaveLength(1)
  })

  it('does not advertise an update when the available version is installed', () => {
    writeState({ current: '0.0.7', available: '0.0.7', status: 'running' })

    expect(getUpgradeStatus().hasUpdate).toBe(false)
  })

  it('reports supervised even before lode has written any state', () => {
    const status = getUpgradeStatus()

    expect(status.supervised).toBe(true)
    expect(status.current).toBeNull()
  })

  it('surfaces a pending request so the UI can poll until lode consumes it', () => {
    writeState({ current: '0.0.97', available: '0.0.98', status: 'running', target: 'latest' })

    expect(getUpgradeStatus().target).toBe('latest')
  })

  it('requests the latest version by default', () => {
    writeState({ current: '0.0.6', status: 'running' })

    requestUpgrade()

    expect(readState().target).toBe('latest')
  })

  it('requests an explicit version', () => {
    writeState({ current: '0.0.6', status: 'running' })

    requestUpgrade('0.0.9')

    expect(readState().target).toBe('0.0.9')
  })

  it('rolls back to the recorded last-good version', () => {
    writeState({ current: '0.0.7', last_good: '0.0.6', status: 'running' })

    expect(requestRollback()).toBe('0.0.6')
    expect(readState().target).toBe('0.0.6')
  })

  it('bumps the restart nonce', () => {
    writeState({ current: '0.0.6', status: 'running', restart_nonce: 2 })

    requestRestart()

    expect(readState().restart_nonce).toBe(3)
  })

  it('reports readiness with the instance token lode injected', () => {
    writeState({ current: '0.0.6', status: 'starting' })

    reportReady()

    expect(readState().ready).toBe('4242-abc')
  })

  it('preserves lode-owned fields when writing a request', () => {
    writeState({ current: '0.0.6', status: 'running', pid: 999, last_good: '0.0.5' })

    requestUpgrade()

    const state = readState()
    expect(state.pid).toBe(999)
    expect(state.current).toBe('0.0.6')
    expect(state.last_good).toBe('0.0.5')
  })
})
