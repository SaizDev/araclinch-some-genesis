---
status: accepted
date: 2026-11-09
deciders: project baseline
---

# 0008: Workers on Fly.io, communicating only through pg-boss

## Context
Six workers (media, agent, render, discovery, publish, analytics) need retries, dead letters and scheduling without a separate queue service, and must be changed independently by different agents.

## Decision
- pg-boss runs in the Supabase Postgres database; queue names, payload schemas, retry and dead-letter settings live in `packages/queue` and `packages/contracts`.
- Workers never call or import each other (hooks deny it). They read and write the database and enqueue jobs.
- Each worker is one Fly.io app per environment: `<worker>-dev` (development Supabase project, free to deploy) and `<worker>` (production, deployed only by `/spec-ship`). No public ports.
- Every job is idempotent and records its external spend in `usage_costs`.
- Due posts are picked by `pg_cron`, which enqueues publish jobs.

## Consequences
- Positive: one source of truth for state and jobs; workers deploy independently.
- Negative: queue load shares the database; long jobs need heartbeats and the pg-boss expiry set per queue.
- Open: Fly Machines start strategy (always on versus started per job) is decided in spec 000.
