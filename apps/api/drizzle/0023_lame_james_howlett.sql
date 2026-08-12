ALTER TABLE `issues` ADD `context_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `issues` ADD `context_window` integer DEFAULT 0 NOT NULL;