-- Harness guard tests: security invariants for the whole schema.
-- Runs on the hosted project through the MCP, always rolled back (pnpm harness db test). CI also runs it on its own Supabase stack.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- 1. Every table in the exposed schema has row level security enabled.
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'every table in public has row level security enabled'
);

-- 2. RLS-enabled tables in public have at least one policy, unless the table comment
--    contains "harness:no-policies" (service-role-only tables, documented in data-model.md).
select is(
  (
    select count(*)::int
    from pg_tables t
    where t.schemaname = 'public'
      and t.rowsecurity
      and not exists (
        select 1 from pg_policies p where p.schemaname = t.schemaname and p.tablename = t.tablename
      )
      and coalesce(obj_description(format('%I.%I', t.schemaname, t.tablename)::regclass, 'pg_class'), '')
        not like '%harness:no-policies%'
  ),
  0,
  'every RLS-enabled table in public has at least one policy'
);

-- 3. Views in public run with the privileges of the caller (security_invoker), so RLS applies.
select is(
  (
    select count(*)::int
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and not coalesce(
        (select lower(option_value) in ('true', 'on', '1')
           from pg_options_to_table(c.reloptions)
          where option_name = 'security_invoker'),
        false
      )
  ),
  0,
  'every view in public uses security_invoker'
);

-- 4. SECURITY DEFINER functions in application schemas pin their search_path.
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg like 'search_path=%'
      )
  ),
  0,
  'every security definer function sets search_path'
);

select * from finish();
rollback;
