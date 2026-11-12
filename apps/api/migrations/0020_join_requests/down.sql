DROP TABLE IF EXISTS event_join_requests;
UPDATE events SET visibility = 'invite_only' WHERE visibility = 'approval';
ALTER TABLE events DROP CONSTRAINT events_visibility_check;
ALTER TABLE events ADD CONSTRAINT events_visibility_check
  CHECK (visibility IN ('public', 'friends_of_friends', 'invite_only', 'women_only', 'men_only', 'balanced'));
