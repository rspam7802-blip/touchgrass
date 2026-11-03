DROP TABLE IF EXISTS activity_events;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS suggestion_dismissals;
DROP TABLE IF EXISTS blocks;
DROP VIEW IF EXISTS squad_edges;
DROP TABLE IF EXISTS friendships;
DROP TABLE IF EXISTS contact_hashes;
ALTER TABLE profiles DROP COLUMN IF EXISTS discoverable_by_contacts, DROP COLUMN IF EXISTS share_activity;
