-- Change script for spec 000 (foundation): conventions shared by every project created from the harness.
-- Idempotent: safe to apply again on the development project.

-- Private schema for helper functions and internal tables.
-- It is not exposed through the Supabase Data API (only "public" is exposed by default).
create schema if not exists private;
comment on schema private is 'Internal helpers and tables. Never exposed through the Data API.';

-- Policies that call helpers in "private" need usage on the schema.
grant usage on schema private to authenticated, service_role;

-- Keeps updated_at current. Attach with:
--   create trigger set_updated_at before update on public.<table>
--     for each row execute function private.set_updated_at();
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
