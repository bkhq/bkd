CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`avatar` text,
	`type` text NOT NULL,
	`issue_id` text,
	`endpoint` text,
	`protocol` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_project_name_idx` ON `roles` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `roles_project_id_idx` ON `roles` (`project_id`);--> statement-breakpoint
CREATE INDEX `roles_issue_id_idx` ON `roles` (`issue_id`);