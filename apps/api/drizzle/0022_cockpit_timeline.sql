-- COCKPIT-007 / PLAN-020: Always-on bot timeline.
-- Persistent stream of bot-authored messages with one-click actions.
CREATE TABLE `cockpit_timeline_messages` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `project_id` text REFERENCES `projects`(`id`),
  `issue_id` text REFERENCES `issues`(`id`),
  `body` text NOT NULL,
  `actions` text NOT NULL DEFAULT '[]',
  `signal_key` text NOT NULL,
  `status` text NOT NULL DEFAULT 'open',
  `snoozed_until` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `is_deleted` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX `cockpit_timeline_created_at_idx`
  ON `cockpit_timeline_messages`(`created_at`);
--> statement-breakpoint
CREATE INDEX `cockpit_timeline_status_idx`
  ON `cockpit_timeline_messages`(`status`);
--> statement-breakpoint
CREATE INDEX `cockpit_timeline_issue_id_idx`
  ON `cockpit_timeline_messages`(`issue_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `cockpit_timeline_signal_key_open_uniq`
  ON `cockpit_timeline_messages`(`signal_key`)
  WHERE `status` = 'open';
