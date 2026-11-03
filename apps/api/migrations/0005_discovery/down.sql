DROP INDEX IF EXISTS events_published_starts_idx;
DROP INDEX IF EXISTS events_published_approx_gist;
DROP TABLE IF EXISTS discovery_clicks;
DROP TABLE IF EXISTS discovery_impressions;
DROP FUNCTION IF EXISTS drop_monthly_partitions_before(text, integer);
DROP FUNCTION IF EXISTS ensure_monthly_partitions(text, integer);
