CREATE TABLE `workspaces` (
    `id` text PRIMARY KEY NOT NULL,
    `name` text NOT NULL,
    `description` text,
    `repos` text NOT NULL DEFAULT '[]',
    `created_at` integer NOT NULL,
    `updated_at` integer NOT NULL,
    `is_deleted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `workspace_id` text REFERENCES `workspaces`(`id`);
--> statement-breakpoint
CREATE INDEX `projects_workspace_id_idx` ON `projects` (`workspace_id`);
