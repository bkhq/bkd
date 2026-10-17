-- Decision events become messages of kind 'decision'; ids are kept so open events and Telegram buttons keep working.
INSERT INTO `messages` (
  `id`, `kind`, `expects`, `status`, `level`, `campaign_id`, `source`, `ref`, `title`, `body`,
  `options`, `recommendation`, `blocks`, `continues`, `decision`, `outcome`,
  `withdraw_reason`, `close_reason`, `notified_at`, `created_at`, `updated_at`, `is_deleted`
)
SELECT
  `id`, 'decision', 'reply', `status`, 'info', `campaign_id`, `notify`, `ref`, `question`, `context`,
  `options`, `recommendation`, `blocks`, `continues`, `decision`, `outcome`,
  `withdraw_reason`, `close_reason`, `notified_at`, `created_at`, `updated_at`, `is_deleted`
FROM `decision_events`;
--> statement-breakpoint
INSERT INTO `message_channel_messages` (
  `id`, `webhook_id`, `message_id`, `chat_id`, `chat_message_id`, `created_at`, `updated_at`, `is_deleted`
)
SELECT `id`, `webhook_id`, `event_id`, `chat_id`, `message_id`, `created_at`, `updated_at`, `is_deleted`
FROM `decision_channel_messages`;
--> statement-breakpoint
UPDATE `cron_jobs`
SET `name` = 'message-cleanup', `task_config` = '{"action":"message-cleanup"}'
WHERE `name` = 'decision-event-cleanup';
