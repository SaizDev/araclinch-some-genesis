---
paths:
  - "packages/providers/**"
  - "workers/agent/**"
  - "workers/discovery/**"
  - "workers/media/**"
  - "workers/render/**"
---

# Providers and costs

- Every external service sits behind one adapter interface in `packages/providers` (video generation, Instagram data, TikTok data, YouTube data, voiceover). The active provider comes from `provider_settings`; switching providers never needs a code change in the callers.
- API keys come only from environment variables or Vault; the Settings page shows the choice, never a key.
- Slow providers: submit, store the provider job ID, poll with backoff and a timeout, then store the result in Storage. A failure leaves a visible gap or a failed job, never a silent placeholder.
- Every paid call records provider, units and `cost_eur` in `usage_costs`; when the monthly limit is reached, new paid jobs are refused with a clear message.
- Metrics a platform does not expose are stored as missing, never estimated.
- Claude runs through the Claude Agent SDK in `workers/agent`; prompts and the model ID live in versioned config files there. Outputs are validated against the shared Zod schemas before they leave the worker.
