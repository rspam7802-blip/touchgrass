-- Inviting again someone who was invited but never joined (D-195): when, and how many times.
ALTER TABLE launch_waitlist
  ADD COLUMN reinvited_at timestamptz,
  ADD COLUMN reinvite_count integer NOT NULL DEFAULT 0 CHECK (reinvite_count >= 0);
