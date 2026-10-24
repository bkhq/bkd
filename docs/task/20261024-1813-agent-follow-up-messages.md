# 20261024-1813-agent-follow-up-messages Show agent-sent follow-ups apart from user messages

- **status**: completed
- **priority**: P2
- **owner**: main
- **createdAt**: 2026-10-24 18:13

## Description

Agents using the `bkd` skill (L1/L2 coordinators, message senders) talk to other issues
through `POST /issues/:id/follow-up`, the same route the chat input uses. Their messages
are stored and rendered as user messages (right-aligned bubble), so a conversation mixes
the user's own words with agent instructions. BKD's internal wakes (message reply signal,
`issue-follow-up` cron) land the same way.

Goal: mark who sent a follow-up and render agent and system follow-ups distinctly, while
they keep working as follow-ups (start or queue a turn, recall/edit while queued).

## ActiveForm

Separating agent follow-ups from user messages

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: docs/plan/20261024-1813-agent-follow-up-messages.md

- complete: bun run check passed (993 API, 401 frontend tests). Skill change prepared in zzci/skills, not pushed.
