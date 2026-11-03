-- Phase 12: crews appear in search (F-DSC-09); trigram index for name matching.
CREATE INDEX crews_name_trgm_idx ON crews USING gin (name gin_trgm_ops) WHERE status = 'active';
