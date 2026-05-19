-- SEARCH-001 / PLAN-019: Rebuild issue_logs_fts with a CJK-friendly bigram
-- pipeline. The bigram transform is applied in the application layer (see
-- apps/api/src/db/fts.ts), so the FTS table now stores pre-tokenized text
-- and triggers are replaced by application-level double-write.

DROP TRIGGER IF EXISTS issues_logs_ai;--> statement-breakpoint
DROP TRIGGER IF EXISTS issues_logs_au;--> statement-breakpoint
DROP TRIGGER IF EXISTS issues_logs_ad;--> statement-breakpoint
DROP TABLE IF EXISTS issue_logs_fts;--> statement-breakpoint

CREATE VIRTUAL TABLE issue_logs_fts USING fts5(
  log_id UNINDEXED,
  content,
  tokenize = 'unicode61 remove_diacritics 2'
);
