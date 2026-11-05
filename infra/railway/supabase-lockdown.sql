-- TouchGrass on Supabase: keep every table private (D-162).
-- Supabase publishes the `public` schema through its Data API, readable with the project's public "anon" key.
-- TouchGrass never uses that API (the app talks only to our own API), so take away every grant from the API
-- roles, now and for tables our migrations create later. Run in Supabase → SQL Editor, before the first
-- deploy; it is safe to run again at any time.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke usage on schema public from anon, authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

-- Check: this should return no rows.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');
