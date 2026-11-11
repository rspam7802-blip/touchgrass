-- TouchGrass on Supabase: keep every table private (D-162).
-- Supabase publishes the `public` schema through its Data API, readable with the project's public "anon" key.
-- TouchGrass never uses that API (the app talks only to our own API), so take away every grant from the API
-- roles, now and for tables our migrations create later. Run in Supabase → SQL Editor, before the first
-- deploy; it is safe to run again at any time.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke usage on schema public from anon, authenticated;
-- anon/authenticated also reach the schema through PUBLIC; PostGIS's own tables (spatial_ref_sys and friends)
-- are owned by supabase_admin and keep their grants, so close the schema itself. The app connects as postgres.
revoke usage on schema public from public;
grant usage on schema public to postgres;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

-- Check: both should be false.
select has_schema_privilege('anon', 'public', 'USAGE') as anon_usage,
       has_schema_privilege('authenticated', 'public', 'USAGE') as authenticated_usage;
