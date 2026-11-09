---
id: "000"
title: "Foundation: workspace, auth, data model core, queue, worker skeleton"
type: feature
status: draft
owner: product-manager
created: 2026-11-09
updated: 2026-11-09
related: []
approved_by:
approved_at:
approved_hash:
approved_via:
---

# Foundation: workspace, auth, data model core, queue, worker skeleton

## Summary
Every later spec builds on this one. At the end, an owner or editor signs in with email and MFA, reaches an empty app shell with the navigation of the three processes, and a test job travels from the web app through pg-boss to a worker and back, locally and on the development Fly.io apps.

## Scope
- In: pnpm workspace (web app at the root, `workers/*`, `packages/contracts`, `packages/queue`, `packages/providers`); Supabase Auth with email login, MFA and the roles owner and editor; the core tables (`brand_profile`, `assets`, `asset_children`, `provider_settings`, `usage_costs`, `audit_log`) with RLS; private Storage buckets per library; pg-boss queues with retries and a dead-letter alert; the shared worker base image and one health-check job per worker; `pnpm workers:dev`; development Fly.io apps in `fra`; app shell with navigation (Library, Generate, Discover, Calendar, Settings).
- Out: the three processes themselves (specs 001 to 008), web hosting (not decided yet), Meta integration.

## Acceptance criteria
| ID | Criterion |
|---|---|
| AC-001 | An invited user signs in with email and MFA; an owner sees Settings, an editor does not. |
| AC-002 | Every table in `public` has RLS; a signed-out request reads nothing. |
| AC-003 | Clicking "Run health check" in Settings enqueues one job per worker; each worker, run locally with `pnpm workers:dev`, completes it and the status shows in the app. |
| AC-004 | A job that fails three times lands in the dead-letter queue and shows an alert in the app. |
| AC-005 | Each worker deploys to its development Fly.io app in `fra` with no public port and completes the health check there. |
| AC-006 | A paid call recorded in `usage_costs` counts toward a monthly limit; when the limit is reached, new paid jobs are refused with a clear message. |

## Open questions (for the intake)
- How workers start when jobs wait on Fly.io (dispatcher with the Machines API, or always-on with a minimum of one machine). ADR in this spec.
- Who is invited first (owner email), and whether editors exist from day one.
- Monthly spending limit to start with.

## Intake decisions
<!-- The questions asked and the answers given. -->

## Changelog
| Date | Change | By |
|---|---|---|
| 2026-11-09 | Created from the system specification | harness |
