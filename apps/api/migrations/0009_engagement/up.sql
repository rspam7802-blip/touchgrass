-- Phase 8: "I'm free now", recurring crews, collaborative plans, gamification (facts, badges, streaks,
-- challenges, recaps) and referral rewards.

-- ---------- F-ENG-01 ----------
CREATE TABLE availability_status (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  until timestamptz NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX availability_status_until_idx ON availability_status (until);
CREATE TRIGGER availability_status_updated_at BEFORE UPDATE ON availability_status FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- F-ENG-02 ----------
CREATE TABLE crews (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  city_id uuid REFERENCES cities (id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 3 AND 60),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  interest_id uuid REFERENCES interests (id) ON DELETE SET NULL,
  cover_media_id uuid REFERENCES media_assets (id) ON DELETE SET NULL,
  join_policy text NOT NULL DEFAULT 'request' CHECK (join_policy IN ('request', 'invite_only')),
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crews_discover_idx ON crews (city_id, created_at DESC, id DESC) WHERE status = 'active' AND join_policy = 'request';
CREATE TRIGGER crews_updated_at BEFORE UPDATE ON crews FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE crew_members (
  crew_id uuid NOT NULL REFERENCES crews (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status text NOT NULL CHECK (status IN ('active', 'requested', 'invited')),
  invited_by uuid REFERENCES users (id) ON DELETE SET NULL,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (crew_id, user_id),
  CHECK ((status = 'active') = (joined_at IS NOT NULL))
);
CREATE INDEX crew_members_user_idx ON crew_members (user_id, status);
CREATE INDEX crew_members_crew_status_idx ON crew_members (crew_id, status, joined_at);
CREATE TRIGGER crew_members_updated_at BEFORE UPDATE ON crew_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE crew_recurrence (
  crew_id uuid PRIMARY KEY REFERENCES crews (id) ON DELETE CASCADE,
  rrule text NOT NULL,
  starts_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 30 AND 720),
  capacity integer NOT NULL CHECK (capacity >= 2),
  title text NOT NULL DEFAULT '',
  -- The plan's location as entered (a venue id, or a pin + address), replayed for every session.
  location_where jsonb NOT NULL,
  place_label text NOT NULL,
  -- The admin who set the schedule hosts the generated sessions.
  host_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  generated_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crew_recurrence_due_idx ON crew_recurrence (generated_until) WHERE active;
CREATE TRIGGER crew_recurrence_updated_at BEFORE UPDATE ON crew_recurrence FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE crew_sessions (
  crew_id uuid NOT NULL REFERENCES crews (id) ON DELETE CASCADE,
  occurrence_at timestamptz NOT NULL,
  event_id uuid NOT NULL UNIQUE REFERENCES events (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (crew_id, occurrence_at)
);

-- Crew chats (Phase 5 left the column unconstrained until crews existed).
ALTER TABLE conversations ADD CONSTRAINT conversations_crew_fk FOREIGN KEY (crew_id) REFERENCES crews (id) ON DELETE CASCADE;

-- ---------- F-ENG-03 ----------
CREATE TABLE plan_proposals (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  creator_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  city_id uuid REFERENCES cities (id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category_interest_id uuid REFERENCES interests (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked', 'cancelled')),
  deadline timestamptz NOT NULL,
  auto_lock boolean NOT NULL DEFAULT true,
  capacity integer NOT NULL CHECK (capacity >= 2),
  event_id uuid REFERENCES events (id) ON DELETE SET NULL,
  cancelled_reason text,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_proposals_due_idx ON plan_proposals (deadline) WHERE status = 'open';
CREATE INDEX plan_proposals_creator_idx ON plan_proposals (creator_id, created_at DESC);
CREATE TRIGGER plan_proposals_updated_at BEFORE UPDATE ON plan_proposals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE proposal_invitees (
  proposal_id uuid NOT NULL REFERENCES plan_proposals (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, user_id)
);
CREATE INDEX proposal_invitees_user_idx ON proposal_invitees (user_id);

CREATE TABLE proposal_options (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  proposal_id uuid NOT NULL REFERENCES plan_proposals (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('time', 'place', 'activity')),
  label text NOT NULL DEFAULT '',
  starts_at timestamptz,
  ends_at timestamptz,
  location_where jsonb,
  address text,
  interest_id uuid REFERENCES interests (id) ON DELETE SET NULL,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'time') = (starts_at IS NOT NULL AND ends_at IS NOT NULL)),
  CHECK ((kind = 'place') = (location_where IS NOT NULL))
);
CREATE INDEX proposal_options_proposal_idx ON proposal_options (proposal_id, kind, created_at);

CREATE TABLE proposal_votes (
  option_id uuid NOT NULL REFERENCES proposal_options (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, user_id)
);
CREATE INDEX proposal_votes_user_idx ON proposal_votes (user_id);

-- ---------- F-GAM ----------
-- One row per person and thing that happened (a check-in, a hosted plan, a reconnect…), so replayed domain
-- events never double count. Badges, streaks, challenges and recaps are all derived from it.
CREATE TABLE gamification_facts (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  ref text NOT NULL,
  at timestamptz NOT NULL,
  attrs jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, kind, ref)
);
CREATE INDEX gamification_facts_time_idx ON gamification_facts (user_id, kind, at);

CREATE TABLE badges (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_]{3,40}$'),
  name jsonb NOT NULL,
  description jsonb NOT NULL,
  emoji text NOT NULL,
  rule jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  builtin boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER badges_updated_at BEFORE UPDATE ON badges FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_badges (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  badge_id uuid NOT NULL REFERENCES badges (id) ON DELETE CASCADE,
  earned_at timestamptz NOT NULL DEFAULT now(),
  -- The plan whose check-in (or wrap-up) earned it, for the post-event card.
  event_id uuid REFERENCES events (id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, badge_id)
);
CREATE INDEX user_badges_badge_idx ON user_badges (badge_id);
CREATE INDEX user_badges_event_idx ON user_badges (user_id, event_id);

CREATE TABLE streaks (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  current integer NOT NULL DEFAULT 0,
  longest integer NOT NULL DEFAULT 0,
  -- The ISO week a "streak at risk" reminder last went out for (one per week).
  reminded_week text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX streaks_live_idx ON streaks (current) WHERE current > 0;

CREATE TABLE streak_freezes (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  week text NOT NULL CHECK (week ~ '^\d{4}-W\d{2}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week)
);

CREATE TABLE challenges (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  title jsonb NOT NULL,
  description jsonb NOT NULL,
  emoji text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  mode text NOT NULL CHECK (mode IN ('solo', 'group')),
  criteria jsonb NOT NULL,
  reward_badge_id uuid REFERENCES badges (id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX challenges_live_idx ON challenges (ends_at) WHERE active;
CREATE TRIGGER challenges_updated_at BEFORE UPDATE ON challenges FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE challenge_participants (
  challenge_id uuid NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Group challenges: the crew whose members' progress counts together.
  crew_id uuid REFERENCES crews (id) ON DELETE SET NULL,
  progress integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX challenge_participants_user_idx ON challenge_participants (user_id);
CREATE INDEX challenge_participants_team_idx ON challenge_participants (challenge_id, crew_id);

CREATE TABLE recaps (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period IN ('month', 'year')),
  key text NOT NULL,
  stats jsonb NOT NULL,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period, key)
);
CREATE INDEX recaps_user_idx ON recaps (user_id, created_at DESC);

-- ---------- F-GRW-01 ----------
CREATE TABLE referral_codes (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE referrals (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  referrer_id uuid REFERENCES users (id) ON DELETE SET NULL,
  referee_id uuid UNIQUE REFERENCES users (id) ON DELETE SET NULL,
  code text NOT NULL,
  -- Fraud checks: one reward per phone number and per device, kept (unlinked) after erasure.
  referee_phone_hash text NOT NULL,
  referee_device_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rewarded', 'rejected')),
  reject_reason text,
  rewarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referrals_referrer_idx ON referrals (referrer_id, created_at DESC);
CREATE UNIQUE INDEX referrals_rewarded_phone_idx ON referrals (referee_phone_hash) WHERE status = 'rewarded';
CREATE UNIQUE INDEX referrals_rewarded_device_idx ON referrals (referee_device_id) WHERE status = 'rewarded' AND referee_device_id IS NOT NULL;
CREATE TRIGGER referrals_updated_at BEFORE UPDATE ON referrals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE referral_rewards (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  referral_id uuid REFERENCES referrals (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('priority_pass', 'credit')),
  remaining integer NOT NULL CHECK (remaining >= 0),
  -- Credits: the most a free entry covers, fixed when it was granted.
  max_paise integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referral_rewards_balance_idx ON referral_rewards (user_id, kind, created_at) WHERE remaining > 0;
CREATE TRIGGER referral_rewards_updated_at BEFORE UPDATE ON referral_rewards FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE referral_reward_uses (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  reward_id uuid NOT NULL REFERENCES referral_rewards (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event_id uuid REFERENCES events (id) ON DELETE SET NULL,
  -- Credits: the payment it paid for; the credit comes back if that ticket is refunded.
  payment_id uuid UNIQUE REFERENCES payments (id) ON DELETE SET NULL,
  restored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referral_reward_uses_user_idx ON referral_reward_uses (user_id);

-- ---------- built-in badges (F-GAM-01) ----------
INSERT INTO badges (key, name, description, emoji, rule, builtin, sort) VALUES
('grass_toucher',
 '{"en":"Grass Toucher","te":"గ్రాస్ టచర్","hi":"ग्रास टचर"}',
 '{"en":"Checked in to your first plan.","te":"నీ మొదటి ప్లాన్‌కి చెక్-ఇన్ అయ్యావ్.","hi":"अपने पहले प्लान पर चेक-इन किया."}',
 '🌱', '{"type":"count","fact":"check_in","threshold":1,"onTimeOnly":false}', true, 10),
('certified_outside',
 '{"en":"Certified Outside","te":"సర్టిఫైడ్ అవుట్‌సైడ్","hi":"सर्टिफ़ाइड आउटसाइड"}',
 '{"en":"Checked in to 10 plans.","te":"10 ప్లాన్‌లకు చెక్-ఇన్ అయ్యావ్.","hi":"10 प्लान पर चेक-इन किया."}',
 '🌳', '{"type":"count","fact":"check_in","threshold":10,"onTimeOnly":false}', true, 20),
('main_character',
 '{"en":"Main Character","te":"మెయిన్ క్యారెక్టర్","hi":"मेन कैरेक्टर"}',
 '{"en":"Hosted 5 plans people showed up to.","te":"జనం వచ్చిన 5 ప్లాన్‌లు హోస్ట్ చేశావ్.","hi":"5 प्लान होस्ट किए जिनमें लोग आए."}',
 '🎬', '{"type":"count","fact":"hosted","threshold":5,"onTimeOnly":false}', true, 30),
('early_bird',
 '{"en":"Early Bird","te":"ఎర్లీ బర్డ్","hi":"अर्ली बर्ड"}',
 '{"en":"Checked in on time 5 times.","te":"5 సార్లు టైమ్‌కి చెక్-ఇన్ అయ్యావ్.","hi":"5 बार टाइम पर चेक-इन किया."}',
 '🐦', '{"type":"count","fact":"check_in","threshold":5,"onTimeOnly":true}', true, 40),
('connector',
 '{"en":"Connector","te":"కనెక్టర్","hi":"कनेक्टर"}',
 '{"en":"Reconnected with 10 people you met.","te":"కలిసిన 10 మందితో రీకనెక్ట్ అయ్యావ్.","hi":"मिले हुए 10 लोगों से रीकनेक्ट किया."}',
 '🤝', '{"type":"count","fact":"reconnect","threshold":10,"onTimeOnly":false}', true, 50),
('crew_regular',
 '{"en":"Crew Regular","te":"క్రూ రెగ్యులర్","hi":"क्रू रेगुलर"}',
 '{"en":"Made 5 sessions of the same crew.","te":"ఒకే క్రూ 5 సెషన్‌లకు వచ్చావ్.","hi":"एक ही क्रू के 5 सेशन में आए."}',
 '🔁', '{"type":"group_count","fact":"crew_session","field":"crewId","threshold":5}', true, 60),
('explorer',
 '{"en":"Explorer","te":"ఎక్స్‌ప్లోరర్","hi":"एक्सप्लोरर"}',
 '{"en":"Checked in across 5 neighbourhoods.","te":"5 ఏరియాల్లో చెక్-ఇన్ అయ్యావ్.","hi":"5 इलाक़ों में चेक-इन किया."}',
 '🧭', '{"type":"distinct","fact":"check_in","field":"neighbourhoodId","threshold":5}', true, 70),
('challenge_champ',
 '{"en":"Challenge Champ","te":"ఛాలెంజ్ ఛాంప్","hi":"चैलेंज चैंप"}',
 '{"en":"Completed 3 challenges.","te":"3 ఛాలెంజ్‌లు పూర్తి చేశావ్.","hi":"3 चैलेंज पूरे किए."}',
 '🏆', '{"type":"count","fact":"challenge_completed","threshold":3,"onTimeOnly":false}', true, 80),
('lore_keeper',
 '{"en":"Lore Keeper","te":"లోర్ కీపర్","hi":"लोर कीपर"}',
 '{"en":"Added 10 photos to the Lore.","te":"లోర్‌కి 10 ఫొటోలు జోడించావ్.","hi":"लोर में 10 फ़ोटो जोड़ीं."}',
 '📸', '{"type":"count","fact":"lore_photo","threshold":10,"onTimeOnly":false}', true, 90),
('plug',
 '{"en":"Plug","te":"ప్లగ్","hi":"प्लग"}',
 '{"en":"A friend you invited checked in to their first plan.","te":"నువ్వు ఇన్వైట్ చేసిన ఫ్రెండ్ వాళ్ల మొదటి ప్లాన్‌కి చెక్-ఇన్ అయ్యారు.","hi":"तुम्हारे बुलाए दोस्त ने अपने पहले प्लान पर चेक-इन किया."}',
 '🔌', '{"type":"count","fact":"referral","threshold":1,"onTimeOnly":false}', true, 100);
