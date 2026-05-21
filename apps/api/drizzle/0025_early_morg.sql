ALTER TABLE `cockpit_timeline_messages` ADD `enrichment_status` text DEFAULT 'template' NOT NULL;--> statement-breakpoint
ALTER TABLE `cockpit_timeline_messages` ADD `enrichment_error` text;