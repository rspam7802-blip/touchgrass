-- Video stories (D-164): a media asset can be a video, re-encoded by the worker. Its length is kept so the
-- story viewer can time its progress bar; the files (video + poster variants) live in variant_keys.
ALTER TABLE media_assets ADD COLUMN duration_ms integer CHECK (duration_ms IS NULL OR duration_ms > 0);

-- Hourly clean-up of story photos/videos never posted and selfies never submitted pages through one
-- purpose's live assets in id order.
CREATE INDEX media_assets_purpose_live_idx ON media_assets (purpose, id) WHERE deleted_at IS NULL;
