---
spec: "{{id}}"
title: "API: {{title}}"
owner: solution-architect
updated: {{date}}
---
<!-- harness:template -->
<!-- Authors: solution-architect with backend-engineer. Remove the marker when complete. One section per Server Action or Route Handler. -->

# API contracts: {{title}}

## Conventions
- Server Actions return `{ ok: true, data } | { ok: false, error: { code, message, fieldErrors? } }`.
- Error codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL`.
- Inputs validated with Zod schemas in `src/lib/validation/`.

## Server Actions

### `createExample` (`src/server/actions/example.ts`)
| Field | Value |
|---|---|
| Input | `z.object({ workspaceId: z.string().uuid(), name: z.string().min(1).max(120) })` |
| Output | `{ id: string, name: string, createdAt: string }` |
| Authorization | member of `workspaceId` (DAL check) + RLS insert policy |
| Errors | `VALIDATION`, `FORBIDDEN`, `CONFLICT` (duplicate name) |
| Side effects | `revalidateTag('examples:<workspaceId>')` |
| Idempotency | not idempotent; UI disables resubmit while pending |
| ACs | AC-001, AC-002 |

## Route Handlers

### `POST /api/webhooks/example`
| Field | Value |
|---|---|
| Auth | HMAC signature header, verified with a server secret |
| Body | Zod schema ... |
| Responses | 200 processed, 400 invalid, 401 bad signature, 409 duplicate event |
| Rate limit | |
| Idempotency | event id stored, duplicates ignored |
| Cache | `Cache-Control: no-store` |

## External integrations
| Service | Purpose | Timeout | Retries | Secrets |
|---|---|---|---|---|
