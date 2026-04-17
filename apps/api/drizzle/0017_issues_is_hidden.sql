ALTER TABLE `issues` ADD `is_hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Back-fill: mark existing whiteboard-bound issues as hidden so they disappear
-- from the regular issues list immediately after this migration runs.
UPDATE `issues` SET `is_hidden` = 1 WHERE `id` IN (
  SELECT `bound_issue_id` FROM `whiteboard_nodes` WHERE `bound_issue_id` IS NOT NULL
);
