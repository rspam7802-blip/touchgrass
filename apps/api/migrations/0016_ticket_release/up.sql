-- A payment stops backing a ticket when its holder cancels. Released payments are never treated as the
-- current ticket again (refund quotes, a later cancel, or the duplicate-payment check on a re-purchase).
ALTER TABLE payments ADD COLUMN ticket_released_at timestamptz;
