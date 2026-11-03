DROP TABLE IF EXISTS neighbourhoods;
DROP TABLE IF EXISTS cities;
DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS feature_flags;
DROP FUNCTION IF EXISTS ensure_monthly_partition(regclass, date);
DROP FUNCTION IF EXISTS set_updated_at();
DROP FUNCTION IF EXISTS uuid_v7();
