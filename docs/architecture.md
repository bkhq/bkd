# Architecture

## Overview
BitK is a Kanban application with a Bun/Hono backend and a React/Vite frontend.

## Backend
- Runtime: Bun (`Bun.serve`)
- Router: Hono mounted under `/api`
- Database: SQLite via `bun:sqlite` and Drizzle ORM
- Logging: pino

## Frontend
- Framework: React + Vite + TypeScript
- Data: TanStack React Query for server state
- Local UI state: Zustand stores
- Styling: Tailwind CSS and shadcn/ui components

## Execution Model
- Issue execution and follow-up are process-driven and tracked via issue-scoped records.
- API responses follow a unified envelope: `{ success, data | error }`.
