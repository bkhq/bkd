ALTER TABLE `projects` ADD `sort_order` text DEFAULT 'a0' NOT NULL;--> statement-breakpoint
ALTER TABLE `webhook_deliveries` ADD `dedup_key` text;--> statement-breakpoint
CREATE INDEX `webhook_deliveries_dedup_idx` ON `webhook_deliveries` (`webhook_id`,`dedup_key`,`created_at`);
