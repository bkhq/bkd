# 20261022-0307-skills-management Manage agent skills from the BKD UI

- **status**: completed
- **priority**: P2
- **owner**: main/issue-menu-20261015
- **createdAt**: 2026-10-22 03:07

## Description

Skills are maintained by hand on the host today: the `skills` CLI (vercel-labs/skills)
installs them from GitHub into `~/.agents/skills` (lock file `~/.agents/.skill-lock.json`,
v3) and links them into `~/.claude/skills`; Claude Code and Codex both read them. BKD only
shows skill names in the slash-command list (via `claude -p -- /`, which touches OAuth) and
its file browser cannot open these directories (SEC-007 limits roots to the workspace,
`/srv` on the live instance).

Add a Skills page (user choice: B + C):

- B: list skills by scope (user, shared/installed, project) with name, description,
  source and linked agents; view files; create, edit and delete local skills; copy an
  installed skill into a local one. Installed (lock-managed) skills are read-only because
  `skills update` overwrites local edits.
- C: install from a repository (preview its skills first), update, and remove installed
  skills by running the `skills` CLI non-interactively, with live output.

Acceptance criteria are listed in the plan.

## ActiveForm

Building skills management in the UI

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: docs/plan/20261022-0307-skills-management.md

- complete: B (browse, edit, create, copy, delete) and C (install with preview, update,
  uninstall through the `skills` CLI) shipped, plus upload of `.md` / `.zip` / `.skill`
  and per-skill update status from the lock's `skillFolderHash` against GitHub's tree API
