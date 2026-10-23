# 20261023-1714-model-change-outside-working Apply a model change immediately outside working

- **status**: completed
- **priority**: P2
- **owner**: main
- **createdAt**: 2026-10-23 17:14

## Description

The chat input's model selector only kept the choice in component state and sent it with
the next message. On a todo issue the message is queued and `dispatchFollowUp()` drops the
model, so execution still used the old `issue.model`; without a message the choice was
never stored at all.

Acceptance criteria:

- `PATCH /api/projects/:projectId/issues/:id` accepts `model` and stores it.
- The model cannot be changed while the issue is `working` (409); there it still rides
  on the next message as before.
- Outside `working`, picking a model in the chat input persists it right away, so the
  next execute / follow-up uses it.

## ActiveForm

Applying model changes outside working immediately

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

- complete: PATCH accepts model (409 while working); chat input saves it on select outside working
