/**
 * Single front-end authority for resolving the *effective* engine to display:
 *
 *   explicit user selection → project default → global default.
 *
 * No engine is auto-preset: when the user has made no selection and no
 * project/global default applies, this returns '' so the picker shows the
 * neutral "default" option and the user chooses manually. Used for display
 * only — the request sends the raw user selection (empty → omitted) so the
 * server stays the authority for what gets persisted.
 */

interface InstalledEngine {
  engineType: string
}

export function resolveDefaultEngine(
  userSelection: string,
  projectDefault: string | null | undefined,
  globalDefault: string | null | undefined,
  installed: InstalledEngine[],
): string {
  if (userSelection) return userSelection

  const isInstalled = (e: string | null | undefined): e is string =>
    !!e && installed.some(i => i.engineType === e)

  if (isInstalled(projectDefault)) return projectDefault
  if (isInstalled(globalDefault)) return globalDefault
  return ''
}
