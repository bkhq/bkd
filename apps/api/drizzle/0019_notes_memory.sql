-- Add project association, source tracking, tags, and archiving to notes
ALTER TABLE `notes` ADD COLUMN `project_id` text REFERENCES `projects`(`id`);
ALTER TABLE `notes` ADD COLUMN `issue_id` text REFERENCES `issues`(`id`);
ALTER TABLE `notes` ADD COLUMN `source` text NOT NULL DEFAULT 'manual';
ALTER TABLE `notes` ADD COLUMN `tags` text NOT NULL DEFAULT '[]';
ALTER TABLE `notes` ADD COLUMN `is_archived` integer NOT NULL DEFAULT 0;

-- Index for fast project-scoped queries
CREATE INDEX `notes_project_id_idx` ON `notes`(`project_id`);
-- Index for archived filter
CREATE INDEX `notes_archived_idx` ON `notes`(`is_archived`);
