/**
 * Process entry point.
 *
 * `bkd fix-db` / `bkd --fix-db` repairs the database and exits WITHOUT loading
 * the server, so it works even when normal startup `verifySchema()` would
 * `process.exit(1)`. Any other invocation boots the server.
 *
 * The server bootstrap lives in `./server-main` and is loaded via dynamic
 * import so its db migrate+verify startup side-effect never runs on the
 * fix-db path.
 */
const argv = process.argv.slice(2)

if (argv.includes('fix-db') || argv.includes('--fix-db')) {
  // eslint-disable-next-line antfu/no-top-level-await
  const { repairDatabase } = await import('./db/repair')
  try {
    const result = repairDatabase()
    console.log(
      `[fix-db] database repair complete — applied ${result.applied}, skipped ${result.skipped}`,
    )
    process.exit(0)
  } catch (err) {
    console.error(`[fix-db] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
} else {
  // eslint-disable-next-line antfu/no-top-level-await
  await import('./server-main')
}
