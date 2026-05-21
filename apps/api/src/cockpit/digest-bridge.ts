import { appEvents } from '@/events'
import { logger } from '@/logger'
import {
  classifyIssue,
  clearFailures,
  listReviewIssueIds,
  listStaleWorkingIssueIds,
  recordFailure,
} from './classifier'
import { enrichReplyCard, isSecretaryEnabled } from './secretary'
import type { AppendInput } from './timeline'
import {
  appendOrReplace,
  applyEnrichment,
  recordEnrichmentError,
  supersedeForIssue,
} from './timeline'

/**
 * Append a classifier card, then — for `suggest_reply` cards and when AI
 * enrichment is enabled — kick off the secretary enrichment in the
 * background. The level-2/3 card surfaces instantly; the enriched card
 * patches in via an `update` delta a few seconds later. On failure the
 * card keeps its rung and the reason is recorded on `enrichmentError`.
 */
async function appendAndMaybeEnrich(card: AppendInput): Promise<void> {
  const msg = await appendOrReplace(card)
  if (msg.kind !== 'suggest_reply') return
  if (!(await isSecretaryEnabled())) return
  void enrichReplyCard(msg)
    .then((result) => {
      if (result.ok) return applyEnrichment(msg.id, result.patch)
      return recordEnrichmentError(msg.id, result.reason)
    })
    .catch((err) => {
      logger.warn({ err, msgId: msg.id }, 'cockpit_secretary_apply_failed')
    })
}

const STALE_CHECK_INTERVAL_MS = 10 * 60 * 1000
const STALE_IDLE_THRESHOLD_MIN = 15

/**
 * Wires the cockpit timeline to the existing event bus.
 * Pure event-driven — no polling. Cold-start scan on boot covers
 * process restarts.
 */
export function startCockpitDigestBridge(): () => void {
  const unsubIssueUpdated = appEvents.on('issue-updated', (data) => {
    const next = data.changes?.statusId
    // Only react when the issue *just transitioned into* review, and only
    // when an engine drove the transition (manual user flips are noise).
    if (next !== 'review') {
      // If the engine moved the issue out of review (e.g. user restarted it),
      // any open suggestion for it is stale.
      if (typeof next === 'string' && next !== 'review') {
        void supersedeForIssue(data.issueId).catch((err) => {
          logger.warn({ err, issueId: data.issueId }, 'cockpit_timeline_supersede_failed')
        })
      }
      return
    }
    if (data.source !== 'engine') return
    void classifyIssue(data.issueId, null, { trigger: 'review-transition' })
      .then((res) => {
        if (res) return appendAndMaybeEnrich(res.message)
      })
      .catch((err) => {
        logger.warn({ err, issueId: data.issueId }, 'cockpit_classify_review_failed')
      })
  })

  const unsubChanges = appEvents.on('changes-summary', (data) => {
    void classifyIssue(data.issueId, data, { trigger: 'changes-summary' })
      .then((res) => {
        if (res) return appendAndMaybeEnrich(res.message)
      })
      .catch((err) => {
        logger.warn({ err, issueId: data.issueId }, 'cockpit_classify_changes_failed')
      })
  })

  // Track per-issue failure runs. A successful run resets the counter
  // so a single retry doesn't keep the alert sticky.
  const unsubDone = appEvents.on('done', (data) => {
    if (data.finalStatus === 'completed') {
      clearFailures(data.issueId)
      return
    }
    if (data.finalStatus !== 'failed' && data.finalStatus !== 'cancelled') return
    recordFailure(data.issueId)
    void classifyIssue(data.issueId, null, { trigger: 'failure' })
      .then((res) => {
        if (res) return appendAndMaybeEnrich(res.message)
      })
      .catch((err) => {
        logger.warn({ err, issueId: data.issueId }, 'cockpit_classify_failure_failed')
      })
  })

  // Cold-start: seed timeline for any issue already sitting in review.
  void coldStart().catch((err) => {
    logger.error({ err }, 'cockpit_timeline_cold_start_failed')
  })

  // Periodic stale-in-working check. Bounded interval is the one place
  // we accept a timer — staleness is a time-based property, not an
  // event-derivable one.
  const staleTimer = setInterval(() => {
    void runStaleCheck().catch((err) => {
      logger.warn({ err }, 'cockpit_timeline_stale_check_failed')
    })
  }, STALE_CHECK_INTERVAL_MS)
  // Run one stale sweep shortly after boot so users aren't blind for
  // the first 10 minutes after restart.
  const initialStaleTimer = setTimeout(() => {
    void runStaleCheck().catch((err) => {
      logger.warn({ err }, 'cockpit_timeline_stale_check_failed')
    })
  }, 60_000)

  return () => {
    unsubIssueUpdated()
    unsubChanges()
    unsubDone()
    clearInterval(staleTimer)
    clearTimeout(initialStaleTimer)
  }
}

async function runStaleCheck(): Promise<void> {
  const ids = await listStaleWorkingIssueIds(STALE_IDLE_THRESHOLD_MIN)
  for (const id of ids) {
    try {
      const res = await classifyIssue(id, null, { trigger: 'stale' })
      if (res) await appendAndMaybeEnrich(res.message)
    } catch (err) {
      logger.warn({ err, issueId: id }, 'cockpit_classify_stale_failed')
    }
  }
  if (ids.length > 0) {
    logger.debug({ count: ids.length }, 'cockpit_timeline_stale_swept')
  }
}

async function coldStart(): Promise<void> {
  const ids = await listReviewIssueIds()
  for (const id of ids) {
    try {
      const res = await classifyIssue(id, null, { trigger: 'cold-start' })
      if (res) await appendAndMaybeEnrich(res.message)
    } catch (err) {
      logger.warn({ err, issueId: id }, 'cockpit_timeline_cold_start_issue_failed')
    }
  }
  logger.info({ candidates: ids.length }, 'cockpit_timeline_cold_start_done')
}
