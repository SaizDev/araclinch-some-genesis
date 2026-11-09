---
paths:
  - "src/server/**"
  - "src/app/api/**"
  - "src/app/**/route.ts"
  - "src/app/**/actions.ts"
  - "src/lib/supabase/**"
  - "src/lib/validation/**"
  - "src/proxy.ts"
  - "src/middleware.ts"
  - "src/env.ts"
  - "supabase/functions/**"
---

# Backend rules

- Owner: `backend-engineer`. Follow the `Files`, `How` and `Check` notes of your task in `tasks.md`.
- `src/server/**` files start with `import 'server-only'`; Server Action modules start with `'use server'`.
- Supabase: `createServerClient` from `@supabase/ssr` with Next.js cookies in `src/lib/supabase/server.ts`; `createBrowserClient` in `src/lib/supabase/client.ts`; session refresh helper for `src/proxy.ts` in `src/lib/supabase/proxy.ts`. Service role only in `src/server/supabase/admin.ts`.
- Authenticate on the server with `getClaims()` or `getUser()`. Authorize in the DAL or action before querying, even though RLS also applies.
- DAL functions return DTOs (only the fields the caller needs) and never leak internal errors.
- Server Actions: `parse -> authorize -> execute -> revalidate -> return typed result`. They are public HTTP endpoints; treat inputs as hostile.
- Route Handlers: validate method and body, verify webhook signatures, rate limit public endpoints, set explicit cache headers.
- Environment variables are validated in `src/env.ts` with Zod and documented in `.env.example`.
- External calls: timeouts, retries with backoff only for idempotent operations, no personal data in logs.
- Use generated types from `src/types/database.types.ts` (regenerated from the development project with `mcp__supabase__generate_typescript_types`).
