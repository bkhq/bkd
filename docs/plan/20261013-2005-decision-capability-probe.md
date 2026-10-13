# 20261013-2005-decision-capability-probe Add a decision-events capability probe and drop the bundled skill

- **status**: completed
- **createdAt**: 2026-10-13 20:05
- **approvedAt**: 2026-10-13 20:05
- **relatedTask**: 20261013-2005-decision-capability-probe

## Context

Decision events are mounted at `/api/decisions` (`app.ts`), with routes
declared in `openapi/routes.ts` and handled in `routes/decisions.ts`. There is
no cheap way for a client to tell a server with the feature from one without:
`GET /api/decisions/events` works but returns the whole list. `docs/api/` has
no page for decisions. `skills/bkd/` is an old copy of the skill now
maintained in `zzci/skills`; `scripts/gen-openapi.ts` writes into it by
default and both READMEs install from it.

## Proposal

- `GET /api/decisions` (`getDecisionCapability`): static
  `{ supported: true, contractVersion: 1 }`. It sits at the value a coordinator
  already holds in `BKD_EVENT_URL`.
- New `docs/api/decisions.md`; link it from `docs/api/README.md`; mention the
  probe in `docs/architecture.md` and `CLAUDE.md`/`AGENTS.md` route lists.
- Delete `skills/`. READMEs install the skill from `zzci/skills`.
  `gen-openapi.ts` defaults to `tmp/openapi.json`.

## Risks

- Anyone installing with `npx skills add bkhq/bkd` loses that source.
- `contractVersion` must be bumped by hand when the contract changes.

## Scope

API: `openapi/routes.ts`, `routes/decisions.ts`, one test. Docs: `docs/api/`,
`docs/architecture.md`, READMEs, project instruction file. Removal: `skills/`.

## Alternatives

- A `capabilities` field on `GET /api/health`: one request covers every
  feature, but changes an existing response and the skill would still need the
  decisions base URL separately.

## Annotations

(none)
