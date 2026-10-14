CREATE TABLE `decision_events` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`campaign_id` text NOT NULL,
	`ref` text,
	`question` text NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`options` text DEFAULT '[]' NOT NULL,
	`recommendation` text,
	`blocks` text,
	`continues` text,
	`notify` text NOT NULL,
	`decision` text,
	`outcome` text,
	`withdraw_reason` text,
	`close_reason` text,
	`notified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "decision_events_status_check" CHECK("decision_events"."status" IN ('open','decided','applied','withdrawn','closed'))
);
--> statement-breakpoint
CREATE INDEX `decision_events_status_idx` ON `decision_events` (`status`);--> statement-breakpoint
CREATE INDEX `decision_events_campaign_id_idx` ON `decision_events` (`campaign_id`);