-- Soft-delete every issue bound to a whiteboard node before dropping the
-- table and the `is_hidden` column. Otherwise these "hidden" sessions would
-- become visible in the regular issue list once `is_hidden` is gone.
UPDATE `issues`
SET `is_deleted` = 1,
    `updated_at` = strftime('%s', 'now')
WHERE `id` IN (
  SELECT `bound_issue_id`
  FROM `whiteboard_nodes`
  WHERE `bound_issue_id` IS NOT NULL
);
--> statement-breakpoint
DROP TABLE `whiteboard_nodes`;
--> statement-breakpoint
ALTER TABLE `issues` DROP COLUMN `is_hidden`;
