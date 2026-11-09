---
title: Global non-functional requirements
owner: product-manager
updated: 2026-11-09
---

# Global non-functional requirements

Baseline requirements every spec inherits. Specs may tighten them, never relax them without an ADR. These defaults are reasonable for a modern web product; adjust them with the human at project start.

## This system
| ID | Requirement |
|---|---|
| NFR-P-001 | All data and processing in the EU: Supabase and Fly.io in Frankfurt, in the client's accounts |
| NFR-P-002 | Single tenant: one brand, one Instagram Business account, one Meta ad account |
| NFR-P-003 | Long work (analysis, generation, rendering, discovery, publishing) runs in workers through pg-boss; no web request waits for it |
| NFR-P-004 | Failed jobs retry up to 3 times with backoff, then reach a dead-letter queue that alerts the user |
| NFR-P-005 | Workers scale to zero when the queue is empty; only `web` stays running |
| NFR-P-006 | Every paid call is recorded with provider, units and cost; a monthly limit stops new paid jobs |
| NFR-P-007 | Output formats: post and carousel slides 1080x1350, Reels 1080x1920 up to 90 s |
| NFR-P-008 | Times shown in Europe/Madrid, stored in UTC |
| NFR-P-009 | Retention: discarded drafts and undownloaded search results 7 days, job records 30 days, the rest until the user deletes it |

## Performance (field data, p75, mobile)
| ID | Requirement |
|---|---|
| NFR-G-001 | Largest Contentful Paint under 2.5 s |
| NFR-G-002 | Interaction to Next Paint under 200 ms |
| NFR-G-003 | Cumulative Layout Shift under 0.1 |
| NFR-G-004 | Server Actions and API routes respond in under 500 ms at p95 for normal payloads |
| NFR-G-005 | No request waterfalls on critical routes; first-load client JavaScript per route reviewed when it grows |

## Accessibility
| ID | Requirement |
|---|---|
| NFR-G-010 | WCAG 2.2 level AA for all user-facing screens |
| NFR-G-011 | Complete keyboard operation with visible focus |
| NFR-G-012 | Respect `prefers-reduced-motion` and `prefers-color-scheme` |

## Security
| ID | Requirement |
|---|---|
| NFR-G-020 | Authorization enforced in server code and by Postgres RLS for every table in exposed schemas |
| NFR-G-021 | Secrets only in server environment variables; nothing sensitive in `NEXT_PUBLIC_` variables |
| NFR-G-022 | Security headers: CSP, HSTS, frame-ancestors none, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy |
| NFR-G-023 | Rate limiting on authentication and public endpoints |
| NFR-G-024 | Dependencies without known high or critical vulnerabilities at release |

## Privacy (GDPR)
| ID | Requirement |
|---|---|
| NFR-G-030 | Collect only personal data needed for a documented purpose |
| NFR-G-031 | Data stored in the region agreed with the human (EU by default for EU users) |
| NFR-G-032 | No personal data in logs, analytics events or error reports |
| NFR-G-033 | Users can export and delete their personal data (process documented) |
| NFR-G-034 | Consent required before non-essential cookies or tracking |

## Reliability and operations
| ID | Requirement |
|---|---|
| NFR-G-040 | Every production change is reversible (rollback plan in the release notes) |
| NFR-G-041 | Database migrations are forward-only and tested in CI from an empty database |
| NFR-G-042 | Errors are observable (server logs with request ids; alerting defined in runbooks) |

## Compatibility
| ID | Requirement |
|---|---|
| NFR-G-050 | Last two versions of Chrome, Edge, Firefox and Safari; iOS and Android current versions |
| NFR-G-051 | Responsive from 360 px to 1920 px wide |

## Portability
| ID | Requirement |
|---|---|
| NFR-G-060 | The schema and data can be exported to another SQL service using `db/` artifacts; Supabase-specific constructs are inventoried |
| NFR-G-061 | Business logic lives in application services, not only in database triggers or edge functions |
