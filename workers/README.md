# Workers

Six Node 22 packages, one Fly.io app each (region `fra`), built on `base/`. Specification: `docs/architecture/system-spec.md`; decisions: ADR 0008.

| Folder | Fly apps (dev, prod) | Owner | Jobs |
|---|---|---|---|
| `base/` | (image only) | platform-engineer | Base image (Node 22, Chromium, FFmpeg), job loop, logging, temp dirs |
| `media/` | `worker-media-dev`, `worker-media` | media-engineer | Export ZIP import, FFmpeg, WhisperX (Python), analysis, embeddings |
| `agent/` | `worker-agent-dev`, `worker-agent` | ai-agent-engineer | Claude Agent SDK with the vendored skills, ContentSpec, video and voice generation |
| `render/` | `worker-render-dev`, `worker-render` | media-engineer (templates also frontend-engineer) | Playwright templates, HyperFrames Reels, captions, audio mix, checks |
| `discovery/` | `worker-discovery-dev`, `worker-discovery` | integrations-engineer | Apify, YouTube Data API, yt-dlp, ranking, downloads |
| `publish/` | `worker-publish-dev`, `worker-publish` | integrations-engineer | Instagram Graph publishing, Meta ads, token refresh |
| `analytics/` | `worker-analytics-dev`, `worker-analytics` | integrations-engineer | Post and ad insights |

Rules (hooks enforce the first two):
- A worker never imports another worker; shared code goes to `packages/`.
- Production apps are deployed only by `/spec-ship` after `send to production`; `-dev` apps at any time with `fly deploy --remote-only`.
- Each package has `dev`, `test` and `typecheck` scripts; `pnpm workers:dev` runs every `dev` script against the development project.
- Jobs are idempotent and record external spend in `usage_costs`.
