---
status: accepted
date: 2026-11-09
deciders: project baseline
---

# 0002: Next.js and Supabase for the web app, workers on Fly.io

## Context
The system (`docs/architecture/system-spec.md`) needs a web app for one brand team and long, heavy jobs: media analysis with FFmpeg and WhisperX, headless Chrome rendering, video generation, scraping and publishing. Serverless functions cannot run these jobs.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| Next.js 16 + Supabase for the app, six Node workers on Fly.io (`fra`) with a pg-boss queue in Postgres | One language, managed Postgres with RLS, Auth, Storage and Vault; workers scale to zero and run Chrome and FFmpeg; no extra queue service | Two hosting platforms; the web host is still open |
| One monolith on a VM | Simple deploy | Heavy jobs starve the UI, no scale to zero |
| Serverless only | Small operations burden | Time and memory limits rule out the media and render jobs |

## Decision
The web app is Next.js 16 (React 19, TypeScript strict, Tailwind CSS v4, shadcn/ui) on Supabase (Postgres, Auth, Storage, Vault, pg_cron). The web host is not decided yet and stays neutral: no host-specific features. The jobs run in six workers on Fly.io in `fra`, built on one base image, that communicate only through pg-boss queues (ADR 0008). Zod, Vitest, Playwright and pgTAP; pnpm workspace.

## Consequences
- Positive: heavy work is isolated per worker and scales to zero; the web app stays thin.
- Negative: Fly.io-specific config lives in `workers/*/fly.toml` and `workers/base`; Supabase-specific features are inventoried.
- Portability: workers are plain Node containers; the schema is plain SQL in `migrations/schema.sql`.
