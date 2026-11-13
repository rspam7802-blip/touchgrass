-- Where waitlist sign-ups come from (D-191): the link's ?utm_source= (instagram, whatsapp, …) and, for a
-- friend's referral link (?ref=CODE), that friend. Earlier entries stay NULL ("unknown").
ALTER TABLE launch_waitlist
  ADD COLUMN source text CHECK (source IS NULL OR source ~ '^[a-z0-9_-]{1,32}$'),
  ADD COLUMN referrer_user_id uuid REFERENCES users (id) ON DELETE SET NULL;
-- Charts by source and by referrer over a date range.
CREATE INDEX launch_waitlist_source_idx ON launch_waitlist (source, created_at);
CREATE INDEX launch_waitlist_referrer_idx ON launch_waitlist (referrer_user_id) WHERE referrer_user_id IS NOT NULL;
