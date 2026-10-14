# 20261013-2005-decision-capability-probe Add a decision-events capability probe and drop the bundled skill

- **status**: completed
- **priority**: P2
- **owner**: main/protocol-drift-20261013
- **createdAt**: 2026-10-13 20:05

## Description

The `bkd` skill needs to know whether a BKD server supports decision events
before it raises one. Older servers have no `/api/decisions` mount at all.

Acceptance criteria:

- `GET /api/decisions` returns `{ supported: true, contractVersion: 1 }` in
  the standard envelope; a server without decision events answers 404.
- The route is declared through `@hono/zod-openapi` so it appears in
  `/api/docs/openapi.json`.
- `docs/api/decisions.md` documents the probe and the existing decision-event
  routes, and is linked from `docs/api/README.md`.
- The outdated `skills/` directory is removed; the READMEs point at
  `zzci/skills`, and `scripts/gen-openapi.ts` no longer defaults to a path
  inside it.

## ActiveForm

Adding the decision-events capability probe

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: `docs/plan/20261013-2005-decision-capability-probe.md`. Approval was given in the request.

- complete: Probe test, lint, typecheck and build pass.
