DROP TABLE IF EXISTS analytics_active;
DROP TABLE IF EXISTS analytics_daily;
DROP TABLE IF EXISTS notification_template_overrides;
DROP TABLE IF EXISTS ranking_weights;
DROP TABLE IF EXISTS city_waitlist;
DROP INDEX IF EXISTS events_admin_list_idx;
DROP INDEX IF EXISTS events_featured_idx;
ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_featured_rank_chk,
  DROP COLUMN IF EXISTS featured_by,
  DROP COLUMN IF EXISTS featured_rank,
  DROP COLUMN IF EXISTS featured_until;
