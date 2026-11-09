# Production schema snapshot

`schema.sql` is the SQL that recreates the whole application schema of the **production** Supabase project: schemas, extensions, types, sequences, tables, constraints, indexes, functions, views, triggers, RLS, policies, grants and comments. No data.

It is written by the harness after every release (`/db-snapshot`, which runs a read-only catalog query on production) and committed to git, so git holds its history. Do not edit it by hand.

To recreate the database on a new Supabase project: run `schema.sql` on the empty project (SQL editor or `psql`), then load data separately.
