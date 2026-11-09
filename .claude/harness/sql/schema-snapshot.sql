-- devharness: production schema snapshot (read-only). Returns ONE row with column "ddl": the SQL
-- that recreates the application schema on an empty Supabase project. No data.
-- Covers the application schemas (public plus every schema that is not part of Postgres or the
-- Supabase platform): extensions, schemas, enum and domain types, sequences, functions, tables,
-- constraints, indexes, views, triggers (also app triggers on auth.users), row level security,
-- policies, grants to anon/authenticated/service_role, comments and realtime publication tables.
-- An empty search_path makes every name in the output schema-qualified.
set search_path to '';
with
app_schemas as (
  select n.oid, n.nspname
  from pg_namespace n
  where n.nspname not in (
      'pg_catalog', 'information_schema', 'pg_toast', 'auth', 'storage', 'extensions', 'graphql',
      'graphql_public', 'realtime', '_realtime', 'supabase_functions', 'supabase_migrations', 'vault',
      'pgsodium', 'pgsodium_masks', 'net', 'cron', 'pgbouncer', '_analytics', '_supavisor', 'pgmq',
      'topology', 'tiger', 'tiger_data', 'pgtle', 'repack', 'timescaledb_information')
    and n.nspname not like 'pg\_%'
    and n.nspname not like 'pgtap%'
    and not exists (select 1 from pg_depend d where d.classid = 'pg_namespace'::regclass and d.objid = n.oid and d.deptype = 'e')
),
ext_objects as (
  select d.objid, d.classid from pg_depend d where d.deptype = 'e'
),
app_tables as (
  select c.oid, c.relname, s.nspname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join app_schemas s on s.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and not exists (select 1 from ext_objects e where e.classid = 'pg_class'::regclass and e.objid = c.oid)
),
app_functions as (
  select p.oid, p.proname, s.nspname, p.prokind,
    exists (
      select 1
      from unnest(array_append(p.proargtypes::oid[], p.prorettype)) t(typ)
      join pg_type ty on ty.oid = t.typ
      join app_tables at on at.oid = ty.typrelid
    ) as uses_table_type
  from pg_proc p join app_schemas s on s.oid = p.pronamespace
  where p.prokind in ('f', 'p')
    and not exists (select 1 from ext_objects e where e.classid = 'pg_proc'::regclass and e.objid = p.oid)
),
parts(ord, sub, line) as (
  -- 0. header
  select 0, 0, '-- Production schema snapshot (devharness). Schema only, no data.' || E'\n' ||
    '-- Recreates the application schema on an empty Supabase project. Generated, do not edit by hand.' || E'\n' ||
    'set check_function_bodies = off;' || E'\n' || 'set client_min_messages = warning;'
  -- 1. extensions
  union all
  select 1, 0, format('create extension if not exists %I with schema %I;', e.extname, n.nspname)
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname not in ('plpgsql')
  -- 2. schemas
  union all
  select 2, 0, format('create schema if not exists %I;', s.nspname)
  from app_schemas s where s.nspname <> 'public'
  -- 3. enum types and domains
  union all
  select 3, 0, format('create type %I.%I as enum (%s);', s.nspname, t.typname,
    (select string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid))
  from pg_type t join app_schemas s on s.oid = t.typnamespace
  where t.typtype = 'e'
    and not exists (select 1 from ext_objects e where e.classid = 'pg_type'::regclass and e.objid = t.oid)
  union all
  select 3, 0, format('create domain %I.%I as %s%s%s;', s.nspname, t.typname,
    format_type(t.typbasetype, t.typtypmod),
    case when t.typnotnull then ' not null' else '' end,
    coalesce((select ' ' || string_agg(pg_get_constraintdef(c.oid), ' ') from pg_constraint c where c.contypid = t.oid), ''))
  from pg_type t join app_schemas s on s.oid = t.typnamespace
  where t.typtype = 'd'
    and not exists (select 1 from ext_objects e where e.classid = 'pg_type'::regclass and e.objid = t.oid)
  -- 4. sequences that are not identity sequences
  union all
  select 4, 0, format('create sequence if not exists %I.%I as %s increment by %s minvalue %s maxvalue %s start with %s%s;',
    s.nspname, c.relname, format_type(q.seqtypid, null), q.seqincrement, q.seqmin, q.seqmax, q.seqstart,
    case when q.seqcycle then ' cycle' else '' end)
  from pg_class c join app_schemas s on s.oid = c.relnamespace join pg_sequence q on q.seqrelid = c.oid
  where c.relkind = 'S'
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'i')
    and not exists (select 1 from ext_objects e where e.classid = 'pg_class'::regclass and e.objid = c.oid)
  -- 5. functions that do not take or return table types
  union all
  select 5, 0, pg_get_functiondef(f.oid) || ';'
  from app_functions f where not f.uses_table_type
  -- 6. tables with columns, defaults, identity, generated columns and not null
  union all
  select 6, 0, format('create table %I.%I (%s);', t.nspname, t.relname, coalesce((
    select string_agg(
      format('%I %s', a.attname, format_type(a.atttypid, a.atttypmod)) ||
      case when a.attcollation <> 0 and a.attcollation <> (select typcollation from pg_type where oid = a.atttypid)
        then ' collate ' || (select format('%I.%I', cn.nspname, co.collname) from pg_collation co join pg_namespace cn on cn.oid = co.collnamespace where co.oid = a.attcollation) else '' end ||
      case
        when a.attidentity = 'a' then ' generated always as identity'
        when a.attidentity = 'd' then ' generated by default as identity'
        when a.attgenerated = 's' then ' generated always as (' || pg_get_expr(ad.adbin, ad.adrelid) || ') stored'
        when ad.adbin is not null then ' default ' || pg_get_expr(ad.adbin, ad.adrelid)
        else '' end ||
      case when a.attnotnull then ' not null' else '' end,
      ', ' order by a.attnum)
    from pg_attribute a left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
    where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped), ''))
  from app_tables t
  -- 7. sequence ownership (serial columns)
  union all
  select 7, 0, format('alter sequence %I.%I owned by %I.%I.%I;', s.nspname, c.relname, ts.nspname, tc.relname, a.attname)
  from pg_class c join app_schemas s on s.oid = c.relnamespace
  join pg_depend d on d.objid = c.oid and d.deptype = 'a' and d.refobjsubid > 0
  join pg_class tc on tc.oid = d.refobjid join pg_namespace ts on ts.oid = tc.relnamespace
  join pg_attribute a on a.attrelid = tc.oid and a.attnum = d.refobjsubid
  where c.relkind = 'S'
  -- 8. functions that take or return table types
  union all
  select 8, 0, pg_get_functiondef(f.oid) || ';'
  from app_functions f where f.uses_table_type
  -- 9. primary keys, unique, check and exclusion constraints
  union all
  select 9, 0, format('alter table %I.%I add constraint %I %s;', t.nspname, t.relname, c.conname, pg_get_constraintdef(c.oid))
  from pg_constraint c join app_tables t on t.oid = c.conrelid
  where c.contype in ('p', 'u', 'c', 'x')
  -- 10. foreign keys
  union all
  select 10, 0, format('alter table %I.%I add constraint %I %s;', t.nspname, t.relname, c.conname, pg_get_constraintdef(c.oid))
  from pg_constraint c join app_tables t on t.oid = c.conrelid
  where c.contype = 'f'
  -- 11. indexes that do not back a constraint
  union all
  select 11, 0, pg_get_indexdef(i.indexrelid) || ';'
  from pg_index i join app_tables t on t.oid = i.indrelid
  where not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid and c.contype in ('p', 'u', 'x'))
  -- 12. views and materialized views (in creation order, so views that use views come later)
  union all
  select 12, c.oid::int,
    case c.relkind
      when 'v' then format('create or replace view %I.%I%s as %s', s.nspname, c.relname,
        case when c.reloptions is not null then ' with (' || array_to_string(c.reloptions, ', ') || ')' else '' end,
        rtrim(pg_get_viewdef(c.oid), E'; \n')) || ';'
      else format('create materialized view %I.%I as %s with no data;', s.nspname, c.relname, rtrim(pg_get_viewdef(c.oid), E'; \n'))
    end
  from pg_class c join app_schemas s on s.oid = c.relnamespace
  where c.relkind in ('v', 'm')
    and not exists (select 1 from ext_objects e where e.classid = 'pg_class'::regclass and e.objid = c.oid)
  -- 13. triggers on application tables, and application triggers on platform tables (auth.users)
  union all
  select 13, 0, pg_get_triggerdef(tg.oid) || ';'
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid join pg_namespace cn on cn.oid = c.relnamespace
  join pg_proc p on p.oid = tg.tgfoid
  where not tg.tgisinternal
    and (exists (select 1 from app_tables t where t.oid = c.oid) or p.pronamespace in (select oid from app_schemas))
  -- 14. row level security
  union all
  select 14, 0, format('alter table %I.%I enable row level security;', t.nspname, t.relname) ||
    case when t.relforcerowsecurity then format(E'\nalter table %I.%I force row level security;', t.nspname, t.relname) else '' end
  from app_tables t where t.relrowsecurity
  -- 15. policies
  union all
  select 15, 0, format('create policy %I on %I.%I as %s for %s to %s%s%s;',
    pol.polname, t.nspname, t.relname,
    case when pol.polpermissive then 'permissive' else 'restrictive' end,
    case pol.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end,
    case when pol.polroles = '{0}' then 'public'
      else (select string_agg(quote_ident(r.rolname), ', ' order by r.rolname) from pg_roles r where r.oid = any (pol.polroles)) end,
    case when pol.polqual is not null then ' using (' || pg_get_expr(pol.polqual, pol.polrelid) || ')' else '' end,
    case when pol.polwithcheck is not null then ' with check (' || pg_get_expr(pol.polwithcheck, pol.polrelid) || ')' else '' end)
  from pg_policy pol join app_tables t on t.oid = pol.polrelid
  -- 16. grants to the Supabase API roles (tables, views, sequences, functions, schemas)
  union all
  select 16, 0,
    format('revoke all on %I.%I from anon, authenticated, service_role;', s.nspname, c.relname) ||
    coalesce((
      select string_agg(format(E'\ngrant %s on %I.%I to %I;', g.privs, s.nspname, c.relname, g.rolname), '' order by g.rolname)
      from (
        select r.rolname, string_agg(distinct lower(x.privilege_type), ', ') as privs
        from aclexplode(c.relacl) x join pg_roles r on r.oid = x.grantee
        where r.rolname in ('anon', 'authenticated', 'service_role')
        group by r.rolname
      ) g), '')
  from pg_class c join app_schemas s on s.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'S') and c.relacl is not null
    and not exists (select 1 from ext_objects e where e.classid = 'pg_class'::regclass and e.objid = c.oid)
  union all
  select 16, 0,
    format('revoke all on function %s from public, anon, authenticated, service_role;', format('%I.%I(%s)', f.nspname, f.proname, pg_get_function_identity_arguments(f.oid))) ||
    coalesce((
      select string_agg(format(E'\ngrant execute on function %s to %s;', format('%I.%I(%s)', f.nspname, f.proname, pg_get_function_identity_arguments(f.oid)),
        case when x.grantee = 0 then 'public' else quote_ident(r.rolname) end), '')
      from aclexplode(p.proacl) x left join pg_roles r on r.oid = x.grantee
      where x.grantee = 0 or r.rolname in ('anon', 'authenticated', 'service_role')), '')
  from app_functions f join pg_proc p on p.oid = f.oid
  where p.proacl is not null
  union all
  select 16, 0, string_agg(format('grant usage on schema %I to %I;', s.nspname, r.rolname), E'\n' order by r.rolname)
  from app_schemas s join pg_namespace n on n.oid = s.oid
  cross join lateral aclexplode(n.nspacl) x join pg_roles r on r.oid = x.grantee
  where s.nspname <> 'public' and x.privilege_type = 'USAGE' and r.rolname in ('anon', 'authenticated', 'service_role')
  group by s.oid
  -- 17. comments
  union all
  select 17, 0, format('comment on %s %I.%I is %s;',
    case c.relkind when 'v' then 'view' when 'm' then 'materialized view' else 'table' end,
    s.nspname, c.relname, quote_literal(d.description))
  from pg_description d join pg_class c on c.oid = d.objoid and d.classoid = 'pg_class'::regclass and d.objsubid = 0
  join app_schemas s on s.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm')
  union all
  select 17, 0, format('comment on column %I.%I.%I is %s;', s.nspname, c.relname, a.attname, quote_literal(d.description))
  from pg_description d join pg_class c on c.oid = d.objoid and d.classoid = 'pg_class'::regclass and d.objsubid > 0
  join app_schemas s on s.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid
  union all
  select 17, 0, format('comment on function %s is %s;', format('%I.%I(%s)', f.nspname, f.proname, pg_get_function_identity_arguments(f.oid)), quote_literal(d.description))
  from pg_description d join app_functions f on f.oid = d.objoid and d.classoid = 'pg_proc'::regclass
  union all
  select 17, 0, format('comment on schema %I is %s;', s.nspname, quote_literal(d.description))
  from pg_description d join app_schemas s on s.oid = d.objoid and d.classoid = 'pg_namespace'::regclass
  where s.nspname <> 'public'
  -- 18. tables published for Supabase Realtime
  union all
  select 18, 0, format('alter publication %I add table %I.%I;', p.pubname, t.nspname, t.relname)
  from pg_publication p join pg_publication_rel pr on pr.prpubid = p.oid join app_tables t on t.oid = pr.prrelid
)
select '-- DEVHARNESS_SCHEMA_BEGIN' || E'\n' || string_agg(line, E'\n\n' order by ord, sub, line) || E'\n-- DEVHARNESS_SCHEMA_END' as ddl
from parts;
