-- Guest preference (D-178): hosts can open a plan to everyone, women only or men only.
ALTER TABLE events DROP CONSTRAINT events_visibility_check;
ALTER TABLE events ADD CONSTRAINT events_visibility_check
  CHECK (visibility IN ('public', 'friends_of_friends', 'invite_only', 'women_only', 'men_only', 'balanced'));
