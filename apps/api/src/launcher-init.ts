import { authConfig, discoverOIDC } from './auth'
import { startCockpitDigestBridge } from './cockpit/digest-bridge'
import { startCron } from './cron'
import { issueEngine } from './engines/issue'
import { migrateSlashCommandsKey, refreshSlashCommandsCache } from './engines/issue/queries'
import {
  registerSettledReconciliation,
  startPeriodicReconciliation,
  startupReconciliation,
  stopPeriodicReconciliation,
} from './engines/reconciler'
import { refreshGlobalEnvCache } from './engines/safe-env'
import { startChangesSummaryWatcher, stopChangesSummaryWatcher } from './events/changes-summary'
import { logger } from './logger'
import { acquirePidLock, releasePidLock } from './pid-lock'
import { drainRunningIssues } from './upgrade/drain'
import { initUpgradeSystem, registerShutdownForUpgrade, stopPeriodicCheck } from './upgrade/service'
import { initWebhookDispatcher, startDeliveryCleanup } from './webhooks/dispatcher'

export interface LauncherStops {
  stopCron: () => void
  stopSettledReconciliation: () => void
  stopCockpitDigestBridge: () => void
  stopDeliveryCleanup: () => void
  stopChangesSummaryWatcher: () => void
}

export function initLauncher(): LauncherStops {
  process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise: String(promise) }, 'unhandled_rejection')
  })

  process.on('uncaughtException', (err, origin) => {
    logger.fatal({ err, origin }, 'uncaught_exception')
    setTimeout(() => process.exit(1), 200)
  })

  acquirePidLock()
  process.on('exit', () => releasePidLock())

  if (authConfig.enabled) {
    void discoverOIDC().catch(err => logger.error({ err }, 'oidc_discovery_warmup_failed'))
  }

  void migrateSlashCommandsKey()
    .then(() => refreshSlashCommandsCache())
    .catch(err => logger.error({ err }, 'slash_commands_cache_load_failed'))

  void refreshGlobalEnvCache().catch(err => logger.error({ err }, 'global_env_cache_load_failed'))

  void Promise.resolve().then(async () => {
    const { ensureFtsTokenizerVersion } = await import('./db/fts')
    ensureFtsTokenizerVersion()
  }).catch(err => logger.error({ err }, 'fts_rebuild_failed'))

  void issueEngine.initMaxConcurrent().catch(err => logger.error({ err }, 'init_max_concurrent_failed'))

  void startupReconciliation().catch(err => logger.error({ err }, 'startup_reconciliation_failed'))

  const stopSettledReconciliation = registerSettledReconciliation()
  startPeriodicReconciliation()
  startChangesSummaryWatcher()
  const stopCockpitDigestBridge = startCockpitDigestBridge()
  initWebhookDispatcher()
  const stopDeliveryCleanup = startDeliveryCleanup()
  const stopCron = startCron()

  return {
    stopCron,
    stopSettledReconciliation,
    stopCockpitDigestBridge,
    stopDeliveryCleanup,
    stopChangesSummaryWatcher,
  }
}

export function registerUpgradeShutdown(
  stops: LauncherStops,
  http: { stop: () => void },
) {
  registerShutdownForUpgrade(async () => {
    stops.stopCron()
    stopPeriodicCheck()

    const { drained, remaining } = await drainRunningIssues()
    if (!drained) {
      logger.warn({ remaining }, 'upgrade_proceeding_with_unsettled_issues')
    }

    stops.stopChangesSummaryWatcher()
    stops.stopSettledReconciliation()
    stopPeriodicReconciliation()
    stops.stopDeliveryCleanup()
    stops.stopCockpitDigestBridge()
    await issueEngine.cancelAll()
    http.stop()
    releasePidLock()
    logger.info('server_stopped_for_upgrade')
  })

  void initUpgradeSystem().catch(err => {
    logger.error({ err }, 'upgrade_system_init_failed')
  })
}
