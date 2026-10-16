-- Full-text index over visible user and agent messages, keyed by issues_logs.rowid.
CREATE VIRTUAL TABLE `issues_logs_fts` USING fts5(content, tokenize = 'trigram');
--> statement-breakpoint
CREATE TRIGGER `issues_logs_fts_ai` AFTER INSERT ON `issues_logs`
WHEN new.entry_type IN ('user-message', 'assistant-message') AND new.visible = 1 AND new.is_deleted = 0
BEGIN
  INSERT INTO `issues_logs_fts`(rowid, content) VALUES (new.rowid, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `issues_logs_fts_ad` AFTER DELETE ON `issues_logs`
BEGIN
  DELETE FROM `issues_logs_fts` WHERE rowid = old.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `issues_logs_fts_au` AFTER UPDATE ON `issues_logs`
BEGIN
  DELETE FROM `issues_logs_fts` WHERE rowid = old.rowid;
  INSERT INTO `issues_logs_fts`(rowid, content)
    SELECT new.rowid, new.content
    WHERE new.entry_type IN ('user-message', 'assistant-message') AND new.visible = 1 AND new.is_deleted = 0;
END;
--> statement-breakpoint
INSERT INTO `issues_logs_fts`(rowid, content)
  SELECT rowid, content FROM `issues_logs`
  WHERE entry_type IN ('user-message', 'assistant-message') AND visible = 1 AND is_deleted = 0;
