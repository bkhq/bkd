CREATE TABLE `message_channel_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`message_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`chat_message_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_channel_messages_webhook_message_idx` ON `message_channel_messages` (`webhook_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `message_channel_messages_chat_message_idx` ON `message_channel_messages` (`chat_id`,`chat_message_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`expects` text DEFAULT 'none' NOT NULL,
	`status` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`campaign_id` text,
	`source` text,
	`ref` text,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`options` text DEFAULT '[]' NOT NULL,
	`recommendation` text,
	`blocks` text,
	`continues` text,
	`decision` text,
	`reply` text,
	`outcome` text,
	`withdraw_reason` text,
	`close_reason` text,
	`notified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "messages_kind_check" CHECK("messages"."kind" IN ('decision','notification')),
	CONSTRAINT "messages_expects_check" CHECK("messages"."expects" IN ('none','reply')),
	CONSTRAINT "messages_level_check" CHECK("messages"."level" IN ('info','success','warning','error')),
	CONSTRAINT "messages_status_check" CHECK("messages"."status" IN ('unread','read','open','decided','replied','applied','withdrawn','closed'))
);
--> statement-breakpoint
CREATE INDEX `messages_kind_status_idx` ON `messages` (`kind`,`status`);--> statement-breakpoint
CREATE INDEX `messages_campaign_id_idx` ON `messages` (`campaign_id`);