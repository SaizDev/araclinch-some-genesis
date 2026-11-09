---
status: accepted
date: 2026-01-01
deciders: harness baseline
---

# 0004: Authorization in the data access layer and in Postgres RLS

## Context
Supabase exposes tables through its Data API; RLS is therefore mandatory. Relying only on RLS couples authorization to Supabase and hides it from application tests; relying only on application checks leaves the Data API open.

## Decision
Every read and write is authorized twice:
1. In TypeScript: DAL functions and Server Actions obtain the user from verified claims (`getClaims()`/`getUser()`), check permissions and only then query. They return DTOs with the minimum fields.
2. In Postgres: RLS policies on every exposed table, with explicit roles and ownership or membership predicates, covered by pgTAP tests.
The proxy only refreshes sessions and redirects optimistically. The service-role (secret) key is used only in `src/server/supabase/admin.ts` for operations RLS cannot express, documented in the spec.

## Consequences
- Positive: a missing policy or a missing code check alone does not expose data; authorization logic survives a move off Supabase.
- Negative: two places to keep consistent; the data-model RLS matrix and the api.md authorization column document both.
