# PLAN-007 Extend idle engine timeout

- **status**: completed
- **createdAt**: 2026-05-11 00:00
- **approvedAt**: 2026-05-11 00:00
- **relatedTask**: ENG-004

## Context

Issue engine processes become idle when a turn completes and
`lastIdleAt` is set. The GC sweep terminates non-keepAlive idle processes
after `IDLE_TIMEOUT_MS`; the sweep runs every minute.

The current timeout is 10 minutes. Some background-task workflows can still
have `turnInFlight=true` or otherwise wait on external work in ways that make
the current timeout too aggressive.

## Proposal

Set `IDLE_TIMEOUT_MS` to 90 minutes and add a focused test assertion for the
configured value. Keep existing keepAlive and stall-detection rules unchanged.

## Risks

- Idle reusable engine processes can occupy execution capacity for longer.
- A truly idle process may linger up to about 91 minutes because GC runs once
  per minute.

## Scope

- Runtime change: `apps/api/src/engines/issue/constants.ts`
- Test change: `apps/api/test/gc-stall-detection.test.ts`
- PMA tracking updates for `ENG-004` and `PLAN-007`

## Alternatives

- Fix `turnInFlight` semantics directly. That is more correct long term but
  has broader lifecycle risk.
- Make the timeout configurable. That is unnecessary for the requested change.

## Annotations

- 2026-05-11: User requested increasing the idle timeout to 90 minutes because
  current `turnInFlight` state can be misleading for background-task waits.
- 2026-05-11: Implemented by changing `IDLE_TIMEOUT_MS` to 90 minutes and
  adding a focused constant assertion in GC stall detection tests.
