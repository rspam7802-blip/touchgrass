DROP TABLE IF EXISTS event_comments;

DELETE FROM reports WHERE target_type = 'event_comment';
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'event', 'message', 'lore_media', 'story'));

ALTER TABLE events DROP COLUMN IF EXISTS chat_enabled;
