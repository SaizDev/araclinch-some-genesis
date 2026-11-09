# Threat model

Owner: security-auditor. Update when a spec adds an entry point, a trust boundary or a sensitive data flow.

## Assets
| Asset | Sensitivity | Where it lives |
|---|---|---|
| User accounts and sessions | high | Supabase Auth, cookies |
| Application data | depends on product | Supabase Postgres |
| Secrets (API keys, secret key) | critical | Fly secrets, web host settings, Supabase Vault |

## Trust boundaries
1. Browser to the web app (public internet).
2. Web app server and Fly workers to Supabase (server credentials).
3. Workers to external APIs (Meta, Apify, YouTube, Anthropic, Veo or Kling, ElevenLabs) and downloads from third-party sites (yt-dlp).
3. Browser to Supabase Data API (publishable key, RLS is the only barrier).
4. Harness release to the production database (only after the human types `send to production`).
5. Developer machine and agents to cloud services (MCP servers, CLIs).

## Threats (STRIDE)
| ID | Boundary | Threat | Mitigation | Status |
|---|---|---|---|---|
| T-01 | 3 | Tampering or disclosure through the Data API with a valid user token (BOLA) | RLS ownership predicates + pgTAP tests | baseline |
| T-02 | 1 | Session theft through XSS | CSP with nonces, no raw HTML, HttpOnly cookies | baseline |
| T-03 | 2 | Secret key leaked into client bundle | content-guard hook, `server-only`, review | baseline |
| T-04 | 5 | Prompt injection through fetched content or MCP results causing harmful agent actions | permission denies, hooks, human approval for production actions | baseline |
| T-05 | 4 | Unreviewed destructive migration in production | destructive marker, human test on development, `send to production` approval bound to the script hash | baseline |
