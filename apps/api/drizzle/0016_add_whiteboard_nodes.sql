CREATE TABLE `whiteboard_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL REFERENCES `projects`(`id`),
	`parent_id` text,
	`label` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT '',
	`sort_order` text DEFAULT 'a0' NOT NULL,
	`is_collapsed` integer DEFAULT false NOT NULL,
	`metadata` text,
	`bound_issue_id` text REFERENCES `issues`(`id`),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `whiteboard_nodes_project_id_idx` ON `whiteboard_nodes` (`project_id`);
--> statement-breakpoint
CREATE INDEX `whiteboard_nodes_parent_id_idx` ON `whiteboard_nodes` (`parent_id`);
