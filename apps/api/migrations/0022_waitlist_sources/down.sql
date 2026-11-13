DROP INDEX IF EXISTS launch_waitlist_referrer_idx;
DROP INDEX IF EXISTS launch_waitlist_source_idx;
ALTER TABLE launch_waitlist DROP COLUMN IF EXISTS referrer_user_id, DROP COLUMN IF EXISTS source;
