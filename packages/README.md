# Shared packages

Code shared by the web app and the workers. Packages never import from `src/` or from a worker.

| Folder | Owner | What |
|---|---|---|
| `contracts/` | solution-architect, with backend, media, ai-agent and integrations engineers | Zod schemas and types: job payloads, ContentSpec, database types |
| `queue/` | platform-engineer, backend-engineer | pg-boss client, queue names, retry, expiry and dead-letter settings |
| `providers/` | ai-agent, integrations and media engineers | One adapter interface per external service (Claude, Veo, Kling, ElevenLabs, Apify, YouTube, Meta) and its implementations |

Change a contract first, in its own task, before the workers that use it.
