-- Public launch waitlist (D-169): people without an invite leave a name and a phone number and/or email on
-- the website so the team can invite them. Not tied to an account. One row per phone and per email, so a
-- second submission updates the first. Removed on request (admin) or once no longer needed.
CREATE TABLE launch_waitlist (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  phone_e164 text UNIQUE CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email citext UNIQUE CHECK (email IS NULL OR char_length(email) <= 254),
  city text NOT NULL CHECK (char_length(city) BETWEEN 2 AND 60),
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'te', 'hi')),
  invited_at timestamptz,
  invite_code_id uuid REFERENCES invite_codes (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL)
);
-- Admin list, newest first (all entries, and only those not invited yet).
CREATE INDEX launch_waitlist_list_idx ON launch_waitlist (created_at DESC, id DESC);
CREATE INDEX launch_waitlist_waiting_idx ON launch_waitlist (created_at DESC, id DESC) WHERE invited_at IS NULL;
CREATE TRIGGER launch_waitlist_updated_at BEFORE UPDATE ON launch_waitlist FOR EACH ROW EXECUTE FUNCTION set_updated_at();
