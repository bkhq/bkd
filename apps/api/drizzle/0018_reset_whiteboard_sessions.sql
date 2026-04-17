-- Reset session state for whiteboard-bound issues after the prompt contract
-- changed from tool-calling (`whiteboard-add-node`) to markdown `##` headings.
-- Existing bound issues have `external_session_id` set, so `whiteboardAsk`
-- takes the follow-up path which only sends the turn prompt — leaving the
-- AI session primed with the old tool-oriented system prompt. Clearing the
-- session forces the next ask to re-execute and resend the new system prompt.
UPDATE `issues`
SET `external_session_id` = NULL,
    `session_status` = NULL
WHERE `id` IN (
  SELECT `bound_issue_id` FROM `whiteboard_nodes` WHERE `bound_issue_id` IS NOT NULL
);
