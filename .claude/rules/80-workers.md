---
paths:
  - "workers/**"
  - "packages/**"
---

# Worker rules

- Six workers, one folder each: `workers/media`, `workers/agent`, `workers/render`, `workers/discovery`, `workers/publish`, `workers/analytics`. Each is its own Node 22 package with its own Fly.io app. `workers/base` holds the shared image and runtime helpers.
- Workers never call or import each other (a hook blocks the imports). They communicate only through pg-boss jobs in Postgres; a job carries IDs and storage paths, never file contents.
- Job payloads are typed and validated with Zod schemas from `packages/contracts`; queue names, retry limits (3, exponential backoff) and dead-letter queues are declared once in `packages/queue`.
- Every handler is idempotent: a retry must not duplicate rows, files, posts, ads or charges. Use the job ID or a natural key to detect work already done.
- A handler writes its result and status in Postgres before it enqueues the next job, so a crash between steps is retried, not lost.
- Temp files go to a per-job temp directory that is removed in `finally`. Large files stream to and from Supabase Storage through signed URLs.
- Paid calls: check the monthly limit first, then record provider, units and `cost_eur` in `usage_costs` with the job ID.
- Logs are structured (job ID, queue, step, duration) and never contain secrets, tokens or personal data.
- Local runs: `pnpm workers:dev` starts every worker against the development Supabase project. Deployed workers run on Fly.io in `fra`; development apps end in `-dev`.
