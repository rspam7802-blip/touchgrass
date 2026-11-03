DROP TABLE IF EXISTS story_likes;
DROP TABLE IF EXISTS story_views;
DROP TABLE IF EXISTS stories;

DELETE FROM reports WHERE target_type = 'story';
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'event', 'message', 'lore_media'));
-- Story media rows cannot satisfy the old list; their files are removed by the media purge.
DELETE FROM media_assets WHERE purpose = 'story';
ALTER TABLE media_assets DROP CONSTRAINT media_assets_purpose_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_purpose_check
  CHECK (purpose IN ('profile_photo', 'event_cover', 'lore', 'chat', 'verification_selfie', 'report_screenshot'));
