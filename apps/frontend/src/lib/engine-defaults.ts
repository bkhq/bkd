/**
 * Single front-end authority for resolving the *effective* default engine,
 * mirroring the server precedence in `routes/issues/create.ts`:
 *
 *   explicit user selection → project default → global default → first
 *   installed engine.
 *
 * Used for display only. The request must still send the raw user selection
 * (empty → omitted) so the server stays the authority for what gets
 * persisted; this just shows the user which engine will actually be used.
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
  return installed[0]?.engineType ?? ''
}
