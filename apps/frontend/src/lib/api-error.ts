import type { TFunction } from 'i18next'
import { UPGRADE_DRAINING_CODE } from '@bkd/shared'

/**
 * Map a thrown API error to a user-facing message. Known machine-readable
 * error codes (see `@bkd/shared`) are localized; anything else falls back
 * to the raw error message.
 */
export function apiErrorMessage(err: unknown, t: TFunction): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (raw === UPGRADE_DRAINING_CODE) return t('session.upgradeDraining')
  return raw
}
