CREATE TABLE `issue_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`role_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_roles_issue_id_role_id_uniq` ON `issue_roles` (`issue_id`,`role_id`);--> statement-breakpoint
CREATE INDEX `issue_roles_issue_id_idx` ON `issue_roles` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_roles_role_id_idx` ON `issue_roles` (`role_id`);
