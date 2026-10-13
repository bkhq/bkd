CREATE TABLE `decision_channel_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`event_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `decision_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decision_channel_messages_webhook_event_idx` ON `decision_channel_messages` (`webhook_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `decision_channel_messages_chat_message_idx` ON `decision_channel_messages` (`chat_id`,`message_id`);--> statement-breakpoint
ALTER TABLE `webhooks` ADD `interactive` integer DEFAULT false NOT NULL;