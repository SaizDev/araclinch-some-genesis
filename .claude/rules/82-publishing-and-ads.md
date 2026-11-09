---
paths:
  - "workers/publish/**"
  - "workers/analytics/**"
  - "src/app/**/calendar/**"
  - "supabase/changes/**"
---

# Publishing and ads

- Only generated items with status `approved` can be scheduled. Owned uploads and competitor items never.
- Each item publishes once: a partial unique index on `schedules(content_item_id)` for `scheduled`, `publishing` and `published`, the transition `scheduled` to `publishing` taken in a transaction, and a retry checks first whether Instagram already has the media.
- Publishing: media container from a short-lived signed URL (one child container per carousel slide), poll the container status, then publish; store the media ID and permalink. Failures retry with backoff, then the item becomes `failed` and the user is alerted.
- Ads: campaign, ad set and ad with the published post as the creative; the spend cap and end date are always set on Meta's side. Check whether an AI-content label is required before the ad goes live.
- Meta tokens live in Supabase Vault, are refreshed before they expire, and never reach the browser or logs.
- Times are stored in UTC and shown in Europe/Madrid.
- Read the current Graph API and Marketing API documentation before coding: versions, fields and limits change.
