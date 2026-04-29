# AUTH-001 Remove OIDC authentication

- **status**: completed
- **priority**: P2
- **owner**: claude
- **createdAt**: 2026-04-28

## Description

Remove the optional OIDC + PKCE authentication layer from BKD. The
project's architecture doc declares BKD as a single-user application
(one trusted operator per deployment); the OIDC auth surface adds
considerable code (~7 backend files + 2 frontend pages + token
plumbing in API client / SSE / WebSocket / terminal) for a
deployment shape we are not actually targeting.

After removal, `/api/*` routes become unauthenticated. CORS still
controls cross-origin access via `ALLOWED_ORIGIN`. Operators who
need auth in front of BKD should put it in a reverse proxy.

## ActiveForm

Removing OIDC + PKCE authentication from BKD

## Scope

### Files to delete

Backend:
- `apps/api/src/auth/` (entire directory: `config.ts`, `jwt.ts`,
  `oidc.ts`, `middleware.ts`, `routes.ts`, `types.ts`, `index.ts`)
- `apps/api/test/auth-jwt.test.ts`
- `apps/api/test/auth-middleware.test.ts`

Frontend:
- `apps/frontend/src/pages/LoginPage.tsx`
- `apps/frontend/src/pages/LoginCallbackPage.tsx`
- `apps/frontend/src/lib/auth.ts`
- `apps/frontend/src/hooks/use-auth.ts`
- `apps/frontend/src/__tests__/hooks/use-auth.test.tsx`

### Files to modify

Backend:
- `apps/api/src/app.ts` — drop `authMiddleware` mount, drop
  `/api/auth` route mount, drop `Authorization` from CORS
  `allowHeaders`
- `apps/api/src/index.ts` — drop OIDC discovery warm-up

Frontend:
- `apps/frontend/src/main.tsx` — drop login routes, AuthGate
  wrapper, EventBusManager auth gating
- `apps/frontend/src/lib/kanban-api.ts` — drop `authHeaders()`,
  drop 401 redirect-to-login, drop Authorization in postFormData
- `apps/frontend/src/lib/event-bus.ts` — drop token query param
  on SSE URL
- `apps/frontend/src/components/terminal/TerminalView.tsx` — drop
  token query param on WebSocket URL
- `apps/frontend/src/i18n/{en,zh}.json` — drop auth string keys
  (login, loginDescription, loginWithOAuth, authenticating,
  loginFailed, noCodeReceived, invalidState, backToLogin, logout)

Documentation:
- `CLAUDE.md` — drop the `auth/` module description section
- `docs/architecture.md` — drop auth deployment notes, OAuth/token
  login mention, auth endpoint references
- `docs/api/README.md` — drop auth references and link to
  `system.md` auth section
- `docs/api/system.md` — drop full auth endpoint documentation
- `apps/api/.env.example` and `.env.example` — drop AUTH_* env
  block

### Out of scope

- `engine.authStatus` (`unauthenticated` / `authenticated`) — this
  is per-AI-engine auth status (e.g. Claude Code CLI signed in or
  not), unrelated to OIDC. Leave intact.
- `API_SECRET` env var entries in `.env.example` and the comment
  in `safe-env.ts` — already a no-op (no code references it for
  auth), but `terminal.ts` still strips it from PTY env. Leave
  the strip rule (defensive); leave the doc/comment cleanup for
  a separate sweep if desired.
- The `Authorization` header in CORS allowed list — if any other
  Bearer-style integration ever returns, it would need re-adding.
  Removing keeps the API surface tight; reverse-proxy auth uses
  cookies or its own headers.

## Verification

1. `bun --filter @bkd/api lint` -> verify: no new errors (the
   pre-existing cron lint errors stay)
2. `cd apps/api && bunx tsc --noEmit` -> verify: clean
3. `cd apps/frontend && bunx tsc --noEmit` -> verify: clean
4. `bun run test:api` -> verify: all green (excluding deleted
   auth tests)
5. `bun run test:frontend` -> verify: all green (excluding deleted
   auth tests)
6. `grep -ri 'oidc\|AUTH_ENABLED\|authMiddleware\|LoginPage\|fetchAuthConfig'`
   -> verify: only legitimate residue (e.g. historical plan/task
   docs, audit reports)

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Existing JWT tokens stored in `localStorage[bkd_token]` become
  dead weight on user browsers — harmless. The login UI is gone
  so users won't be prompted again.
- No DB schema changes — auth was env-driven, not DB-backed.
- No package.json dependency removals (auth was implemented
  with native crypto + custom JWT, no `jose` / `openid-client`
  direct deps).
