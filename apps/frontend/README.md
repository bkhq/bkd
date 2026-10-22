# @bkd/frontend

The BKD web UI: React 19 + Vite 8 + TypeScript, Tailwind CSS v4 with shadcn/ui,
react-router-dom v7, TanStack React Query v5 for server state, and Zustand for
UI-only state.

Run it from the repository root, not from this directory:

```bash
bun run dev            # API + frontend, served at http://bkd.localhost (via nsl)
bun run dev:frontend   # frontend only
bun run test:frontend  # vitest
bun run build          # vite build -> apps/frontend/dist/
```

Layout, conventions, and the real-time data flow are documented in
[`docs/development.md`](../../docs/development.md) and
[`docs/architecture.md`](../../docs/architecture.md).
