---
title: Glossary
owner: product-manager
updated: 2026-11-09
---

# Glossary

Use these terms exactly in specs, code, database and UI.

| Term | Definition | Code / table name |
|---|---|---|
| Asset | Any library item: owned, generated, competitor or stock media | `assets` |
| Library | Which collection an asset belongs to: owned, generated, competitor, stock | `assets.library` |
| Rights status | Whether an asset may appear in output (licence or permission on record) | `assets.rights_status` |
| Generation request | One run of Process 1 | `generation_requests` |
| Variant | One generated draft of a request | `content_items` |
| ContentSpec | The JSON plan of a variant: hook, beats or slides, caption, hashtags, assets per beat, gaps | `content_items.spec` |
| Gap | A beat with no suitable owned asset, filled by generation or a cleared stock clip | |
| Competitor search | One run of Process 2 | `competitor_searches` |
| Outlier score | Interactions or views divided by the median of the account's recent posts | `competitor_results.score` |
| Schedule | A calendar entry for an approved variant | `schedules` |
| Run as ad | Option to promote a published post through the Meta Marketing API | `schedules.ad_config`, `ads` |
| Template | Approved visual template reused by every render | `brand_profile.templates` |
| Provider | The external service behind an adapter, chosen in Settings | `provider_settings` |
