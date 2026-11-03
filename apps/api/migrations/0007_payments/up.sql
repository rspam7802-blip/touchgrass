-- Phase 6: host applications, payments (checkout holds, webhooks, refunds, payouts), receipts, host analytics
-- views, venue partnerships and perks.

-- A seat reserved while someone pays (10 minutes). Counted as taken, but not "going" yet.
ALTER TABLE rsvps DROP CONSTRAINT rsvps_status_check;
ALTER TABLE rsvps ADD CONSTRAINT rsvps_status_check
  CHECK (status IN ('going', 'interested', 'waitlisted', 'cancelled', 'checked_in', 'held'));

-- Paid plans carry their refund policy (F-PAY-02).
ALTER TABLE events ADD COLUMN refund_policy jsonb;
ALTER TABLE events ADD CONSTRAINT events_paid_refund_policy CHECK (price_paise = 0 OR refund_policy IS NOT NULL);

-- Where receipts are emailed (F-PAY-05). Optional; never used for anything else.
ALTER TABLE users ADD COLUMN receipt_email text CHECK (receipt_email IS NULL OR length(receipt_email) <= 254);

CREATE TABLE host_applications (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  about text NOT NULL,
  experience text NOT NULL,
  event_ideas text NOT NULL,
  links jsonb NOT NULL DEFAULT '[]',
  review_note text,
  reviewed_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One live application per person; history of rejected ones is kept.
CREATE UNIQUE INDEX host_applications_one_live ON host_applications (user_id) WHERE status IN ('pending', 'approved');
CREATE INDEX host_applications_queue_idx ON host_applications (status, created_at, id);
CREATE TRIGGER host_applications_updated_at BEFORE UPDATE ON host_applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Razorpay Route linked account (KYC) for payouts (F-PAY-03).
CREATE TABLE host_accounts (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  provider_account_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('created', 'activated', 'needs_clarification', 'rejected')),
  legal_business_name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER host_accounts_updated_at BEFORE UPDATE ON host_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE SEQUENCE receipt_number_seq;

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  event_id uuid NOT NULL REFERENCES events (id),
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('created', 'captured', 'failed', 'expired', 'refunded', 'partially_refunded')),
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  refunded_paise integer NOT NULL DEFAULT 0 CHECK (refunded_paise >= 0 AND refunded_paise <= amount_paise),
  fee_bps integer NOT NULL CHECK (fee_bps BETWEEN 0 AND 10000),
  provider_order_id text UNIQUE,
  provider_payment_id text UNIQUE,
  method text,
  checkout_token_hash text NOT NULL UNIQUE,
  hold_expires_at timestamptz NOT NULL,
  captured_at timestamptz,
  receipt_number text UNIQUE,
  receipt_emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- At most one open checkout per person per plan. Paying twice (two tabs) is possible at the bank, so captured
-- duplicates are recorded and refunded rather than rejected.
CREATE UNIQUE INDEX payments_one_open ON payments (event_id, user_id) WHERE status = 'created';
CREATE INDEX payments_user_idx ON payments (user_id, created_at DESC, id DESC);
CREATE INDEX payments_event_idx ON payments (event_id, status);
CREATE INDEX payments_hold_expiry_idx ON payments (hold_expires_at) WHERE status IN ('created', 'failed');
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  payment_id uuid NOT NULL REFERENCES payments (id),
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  reason text NOT NULL CHECK (reason IN ('HOST_CANCELLED', 'BEFORE_CUTOFF', 'HOLD_EXPIRED', 'DUPLICATE', 'ADMIN')),
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  provider_refund_id text UNIQUE,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_payment_idx ON refunds (payment_id);
CREATE INDEX refunds_due_idx ON refunds (created_at) WHERE status IN ('pending', 'failed');
CREATE TRIGGER refunds_updated_at BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One payout per paid plan, to its primary host (F-PAY-03). Amounts are a snapshot of the ledger at creation.
CREATE TABLE payouts (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  event_id uuid NOT NULL UNIQUE REFERENCES events (id),
  host_user_id uuid NOT NULL REFERENCES users (id),
  status text NOT NULL CHECK (status IN ('pending', 'on_hold', 'processing', 'paid', 'failed')),
  hold_reason text,
  gross_paise integer NOT NULL,
  refunds_paise integer NOT NULL,
  platform_fee_paise integer NOT NULL,
  gst_paise integer NOT NULL,
  net_paise integer NOT NULL CHECK (net_paise >= 0),
  attempts integer NOT NULL DEFAULT 0,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payouts_host_idx ON payouts (host_user_id, created_at DESC, id DESC);
CREATE INDEX payouts_due_idx ON payouts (status) WHERE status IN ('pending', 'on_hold', 'failed');
CREATE TRIGGER payouts_updated_at BEFORE UPDATE ON payouts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Route transfers: one per captured payment in the payout, settling the host's share of that payment.
CREATE TABLE payout_transfers (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  payout_id uuid NOT NULL REFERENCES payouts (id) ON DELETE CASCADE,
  payment_id uuid NOT NULL UNIQUE REFERENCES payments (id),
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  provider_transfer_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payout_transfers_payout_idx ON payout_transfers (payout_id, status);
CREATE TRIGGER payout_transfers_updated_at BEFORE UPDATE ON payout_transfers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every verified webhook delivery, once (idempotency by provider event id).
CREATE TABLE payment_webhook_events (
  provider_event_id text PRIMARY KEY,
  type text NOT NULL,
  body jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_webhook_events_retry_idx ON payment_webhook_events (created_at) WHERE status IN ('received', 'failed');
CREATE TRIGGER payment_webhook_events_updated_at BEFORE UPDATE ON payment_webhook_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Distinct viewers per plan per IST day (F-HST-02).
CREATE TABLE event_views (
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day date NOT NULL,
  PRIMARY KEY (event_id, day, viewer_id)
);
CREATE INDEX event_views_viewer_idx ON event_views (viewer_id);

-- Venue partnerships (F-PAY-04).
ALTER TABLE venues ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE venues ADD COLUMN staff_pin_hash text;
CREATE INDEX venues_partner_idx ON venues (city_id, name) WHERE is_partner;

CREATE TABLE venue_perks (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  min_group_size integer NOT NULL DEFAULT 1 CHECK (min_group_size BETWEEN 1 AND 50),
  valid_until timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venue_perks_venue_idx ON venue_perks (venue_id) WHERE active;
CREATE TRIGGER venue_perks_updated_at BEFORE UPDATE ON venue_perks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE perk_redemptions (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  perk_id uuid NOT NULL REFERENCES venue_perks (id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  code text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  group_size integer NOT NULL,
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  method text CHECK (method IN ('qr', 'code')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (perk_id, event_id, user_id)
);
CREATE INDEX perk_redemptions_code_idx ON perk_redemptions (code, perk_id);
CREATE INDEX perk_redemptions_user_idx ON perk_redemptions (user_id);
CREATE TRIGGER perk_redemptions_updated_at BEFORE UPDATE ON perk_redemptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
