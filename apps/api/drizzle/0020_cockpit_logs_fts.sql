-- COCKPIT-002: FTS5 mirror over issue_logs.content for ranked cross-project log search.
-- The shadow table holds only ranked content + rowid pointer back to issue_logs.id.
-- We deliberately do NOT mirror metadata / timestamps — joins resolve those at query time.

CREATE VIRTUAL TABLE IF NOT EXISTS `issue_logs_fts` USING fts5(
  log_id UNINDEXED,
  content,
  tokenize = 'porter unicode61'
);--> statement-breakpoint

-- Backfill existing visible logs
INSERT INTO `issue_logs_fts` (log_id, content)
SELECT id, content FROM issues_logs WHERE is_deleted = 0 AND visible = 1;--> statement-breakpoint

-- Keep in sync via triggers
CREATE TRIGGER IF NOT EXISTS issues_logs_ai AFTER INSERT ON issues_logs
WHEN NEW.is_deleted = 0 AND NEW.visible = 1
BEGIN
  INSERT INTO issue_logs_fts(log_id, content) VALUES (NEW.id, NEW.content);
END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS issues_logs_au AFTER UPDATE ON issues_logs
BEGIN
  DELETE FROM issue_logs_fts WHERE log_id = OLD.id;
  INSERT INTO issue_logs_fts(log_id, content)
    SELECT NEW.id, NEW.content WHERE NEW.is_deleted = 0 AND NEW.visible = 1;
END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS issues_logs_ad AFTER DELETE ON issues_logs
BEGIN
  DELETE FROM issue_logs_fts WHERE log_id = OLD.id;
END;
