-- Fake, idempotent seed data for the development project. Never production data.
-- Rules: fake data only, idempotent (insert ... on conflict do nothing), no production copies.
-- Owner: database-architect.

-- Example (uncomment when the table exists):
-- insert into public.workspaces (id, name)
-- values ('00000000-0000-0000-0000-000000000001', 'Demo workspace')
-- on conflict (id) do nothing;
