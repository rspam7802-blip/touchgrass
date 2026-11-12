UPDATE events SET visibility = 'invite_only' WHERE visibility = 'men_only';
ALTER TABLE events DROP CONSTRAINT events_visibility_check;
ALTER TABLE events ADD CONSTRAINT events_visibility_check
  CHECK (visibility IN ('public', 'friends_of_friends', 'invite_only', 'women_only', 'balanced'));
