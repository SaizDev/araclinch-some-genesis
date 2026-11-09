<!-- Source document for this project (client architecture and specification, Nov 9, 2026). The solution-architect keeps it current; decisions that change it are ADRs in adr/. Hosting of the web app is not decided yet. -->

# Instagram content system: architecture and specification

Nov 9, 2026 · @Ernesto

The system is a web app built around three processes: generate content from a library, find and download competitor content, and schedule unpublished content, with an optional ad. It runs on Supabase plus worker containers on Fly.io, in the client's EU accounts.

## 1. Scope and design rules

| Process | What the user does | Result |
| --- | --- | --- |
| 1. Generate | Selects pictures, videos and carousels, picks a format (post, Reel or carousel) and approves the result | An approved item in the library |
| 2. Discover | Searches by niche, competitor handles or keyword across Instagram, TikTok and YouTube, then downloads chosen results | Items in the competitor library |
| 3. Schedule | Places an approved, never-published item on the calendar, optionally as an ad | A published post and, optionally, a running ad |

Rules that every part of the system enforces:

- **Competitor media never appears in output.** Competitor items are references: the system copies hooks, structure, pacing and scenarios, and rebuilds them with the client's media or AI-generated clips.
- **Short third-party clips need cleared rights.** Stock or third-party clips can be used only when the item is marked with a licence or permission. Being short does not by itself make a clip legal to reuse.
- **Nothing is published without approval.** Only items the user approved can be scheduled, and each item publishes once.
- **The volume is unlimited.** The client controls cost through spending limits on the AI and data provider accounts, not through limits in the app.
- **Single tenant.** One brand, one Instagram Business account and one Meta ad account, in the client's accounts, with Fly.io and Supabase in Frankfurt.

## 2. Architecture

```
browser ──> web (Next.js, public) ──> Supabase (Postgres + pg-boss, Storage, Vault, pg_cron)
                                         ▲
   worker-media · worker-agent · worker-render · worker-discovery · worker-publish · worker-analytics (Fly.io, fra)
                                         │
   external: Anthropic (Claude), video provider (Veo / Kling), data providers (Apify, YouTube Data API), Meta (Graph and Marketing API), ElevenLabs
```

The browser talks only to `web`. Workers never call each other: they take jobs from the `pg-boss` queue in Postgres and pass storage paths and IDs, so a crashed job is retried instead of lost.

| Process | Workers involved |
| --- | --- |
| 1. Generate | `worker-media` (analysis), `worker-agent` (plan, captions), `worker-render` (output) |
| 2. Discover | `worker-agent` (query expansion), `worker-discovery` (search, rank, download), `worker-media` (analysis) |
| 3. Schedule | `pg_cron` (due posts), `worker-publish` (post and ad), `worker-analytics` (results) |

All workers share one base image with Node 22, Chrome and FFmpeg; `worker-media` adds WhisperX. Only `web` stays running; workers start when jobs are waiting.

**Provider settings.** Each external service sits behind one adapter interface, and the active provider is chosen on a Settings page, so switching needs no code change. API keys stay in secrets; Settings only shows the choice.

| Service | Setting | Default | Switchable to |
| --- | --- | --- | --- |
| Video generation | `video_provider` | Set after a quality test on the client's niche | Veo, Kling |
| Instagram data | `discovery_provider.instagram` | Apify | Any provider with an adapter |
| TikTok data | `discovery_provider.tiktok` | Apify | Any provider with an adapter |
| YouTube data | `discovery_provider.youtube` | YouTube Data API | Any provider with an adapter |
| Voiceover | `tts_provider` | ElevenLabs | Any provider with an adapter |
| Subtitles | fixed | WhisperX | None |

## 3. Process 1: generate content

The user selects assets, picks a format and gets reviewable variants; an approved variant becomes a library item that can be scheduled.

**Starting library.** Adrián requests Instagram's "Download your information" export and uploads the ZIP. `worker-media` unpacks it, imports the photos, videos and carousels as owned assets with their original captions and dates, and analyses them. This needs no Meta app and no Instagram password. Once the Meta app exists, an optional sync imports new posts through the official API.

**Inputs**

| Field | Values |
| --- | --- |
| Selected assets | Any mix of owned, approved generated and competitor items; competitor items act as references only |
| Format | Post (1080x1350), carousel (2 to 10 slides, 1080x1350) or Reel (1080x1920, up to 90 s) |
| Brief | Optional goal, product, offer or call to action |
| Variants | Number of drafts to produce, default 3 |
| Voiceover | Off, or on with a voice and language (Reels only) |
| Subtitles | On or off, with a style (Reels only) |
| Music | None, automatic, or a chosen track from the royalty-free music library |

**Pipeline**

1. **Analyse references.** For each selected item, `worker-media` returns scenes, transcript, on-screen text and a structure summary (hook, beats, pacing, call to action). Results are cached on the asset.
2. **Plan.** `worker-agent` runs Claude with the vendored Instagram skills (`ig-reel`, `ig-carousel`, `ig-caption`, `ig-human`) and the brand profile as the skills' `voice.md`. It returns one `ContentSpec` JSON per variant: hook, beats or slides, caption, hashtags, the owned asset for each beat, and any gaps to fill.
3. **Score and clean.** The skills' scripts score hooks, time the beats and lint captions. The hook score only filters weak hooks; it is not used to pick winners.
4. **Fill gaps.** A beat with no suitable owned asset becomes a generation request: a recreated scenario through the video adapter (Veo or Kling), or a cleared stock clip.
5. **Render.** `worker-render` builds posts and carousels from HTML templates with Playwright, and Reels with HyperFrames, FFmpeg normalisation, WhisperX word-level captions, and the chosen voiceover and music mixed into the file.
6. **Check.** Automatic checks for size, duration, text overflow, caption length, and visual similarity to any referenced competitor frame. A variant too close to a reference is rejected and re-planned.
7. **Review.** The user previews each variant, edits the caption or text, regenerates a single part (hook, slide, beat) or discards it.
8. **Add to library.** Approving a variant stores it as a generated library item with status `approved`. Discarded drafts are deleted after 7 days.

**Instagram skills integration.** The [instagram-agent-skill](https://github.com/Jakeschincariol/instagram-agent-skill) repo is MIT licensed and ships Claude skills plus dependency-free Python scripts. It is vendored into `worker-agent` with its licence notice and run through the Claude Agent SDK, which loads skills and lets the agent run their scripts. The skills write and score text only; publishing, rendering and data access belong to this system.

**Templates.** On first setup, the agent proposes visual templates from the client's best posts. Approved templates are reused by every run, so output stays consistent and rendering costs stay predictable.

## 4. Process 2: find and download competitor content

The user runs a search, gets the top N results ranked by interactions, and downloads the ones worth keeping into the competitor library.

**Search inputs**

| Field | Values |
| --- | --- |
| Mode | Niche, competitor handles, or keyword |
| Platforms | Instagram, TikTok, YouTube (any combination) |
| Content type | Video, image, carousel, or all |
| Period | For example the last 30, 90 or 365 days |
| Results | N chosen by the user |

**Flow**

1. **Expand the query.** In niche mode, the agent turns the niche into keywords, hashtags and candidate accounts, which the user can edit before running.
2. **Collect.** `worker-discovery` calls one adapter per platform and stores the candidates with their public metrics.
3. **Rank.** Each candidate gets an outlier score (its views or interactions divided by the median of that account's recent posts, as `ig-viral` does) and an interaction rate (interactions divided by followers). The list is sorted by a weighted mix and cut to N.
4. **Review.** Results show a thumbnail, platform, author, date, metrics, score and a link. Metrics a platform does not expose are shown as missing, never estimated.
5. **Download.** Selected results are downloaded into the competitor bucket with source URL, author, platform, download date and a snapshot of the metrics.
6. **Analyse.** Each download is analysed like an owned asset, so it can be selected as a reference in Process 1.

**Platform adapters**

| Platform | Search and metrics | Download |
| --- | --- | --- |
| Instagram | Third-party data provider | Provider media URL |
| TikTok | Third-party data provider | Provider media URL |
| YouTube | YouTube Data API (search, statistics) | Provider or yt-dlp |

Adapters share one interface (`search`, `getMetrics`, `download`), so the provider for each platform is switched in Settings without code changes. Search results that are not downloaded expire after 7 days. Platform terms may restrict collecting and downloading this content; under the contract, using this function is the client's decision and responsibility.

## 5. Process 3: schedule and publish

The user places an approved generated item on the calendar; at its time the system publishes it once and, if chosen, runs it as an ad.

**Meta app.** Publishing, ads, insights and the API library sync all go through one Meta app in Adrián's Business account. Because it only touches his own accounts, development mode should be enough, without Meta's app review. The integration is built last, so content generation is tested without it; business verification is requested at the start because it can take days.

**Eligibility.** Only generated items with status `approved` can be scheduled. Owned uploads and competitor items cannot. The database allows one active or completed schedule per item, so nothing is published twice.

**Calendar**

- Month and week views, drag and drop to a date and time, in the client's time zone (Europe/Madrid).
- Final caption edit, first comment and location before publishing.
- Moving or cancelling is allowed until publishing starts.

**Publishing flow**

1. Every minute, the scheduler queues a `publish` job for items whose time has come.
2. `worker-publish` creates an Instagram media container from a short-lived signed URL to the file in Supabase Storage. Carousels create one child container per slide.
3. It polls the container status until it is ready, then calls `media_publish`.
4. It stores the Instagram media ID and permalink, and the item becomes `published`.
5. On failure, it retries with backoff, then marks the item `failed` and alerts the user, who can reschedule it.

**Optional ad.** When scheduling, the user can switch on "Run as ad" and set the objective, daily budget, end date and audience preset. After publishing, the worker creates a campaign, ad set and ad through the Meta Marketing API, using the published post as the creative. Each ad has a spend cap and end date set on Meta's side, so it stops even if the app is down. The Meta app is created inside the client's Business account, which avoids the longer review needed to manage other people's ad accounts.

**After publishing.** `worker-analytics` collects Instagram and ad insights after 24 hours and 7 days, and feeds them into the planner for future generations.

## 6. Data model and states

All tables live in Supabase Postgres with row-level security; files live in Supabase Storage, in separate buckets per library.

| Table | Holds | Key fields |
| --- | --- | --- |
| `brand_profile` | Voice, values, tone rules, approved templates | `voice_md`, `templates` |
| `assets` | Every library item: owned, generated, competitor or stock | `library`, `kind` (image, video, carousel), `storage_path`, `rights_status`, `source_url`, `author`, `analysis`, `embedding` |
| `asset_children` | Slides of a carousel | `asset_id`, `position` |
| `generation_requests` | One run of Process 1 | `asset_ids`, `format`, `brief`, `variants`, `status` |
| `content_items` | Each generated variant | `request_id`, `spec` (ContentSpec JSON), `caption`, `media_paths`, `status`, `asset_id` once approved |
| `competitor_searches` | One run of Process 2 | `mode`, `query`, `platforms`, `limit`, `status` |
| `competitor_results` | Ranked candidates | `platform`, `url`, `metrics`, `score`, `expires_at`, `asset_id` once downloaded |
| `schedules` | Calendar entries | `content_item_id`, `publish_at`, `status`, `ig_media_id`, `ad_config` |
| `ads` | Ads created from schedules | `schedule_id`, Meta campaign, ad set and ad IDs, `daily_budget`, `end_date`, `status` |
| `insights` | Post and ad metrics over time | `content_item_id`, `captured_at`, `metrics` |
| `usage_costs` | AI and provider spend per job | `job_id`, `provider`, `units`, `cost_eur` |
| `audit_log` | Who did what and when | `actor`, `action`, `entity`, `at` |
| `imports` | Instagram export ZIP imports | file, status, imported and skipped counts |
| `music_tracks` | Royalty-free music library | storage\_path, title, source, licence, licence\_url, mood, duration |
| `provider_settings` | Active provider per service | service, provider, options |

**Rules in the database**

- `assets.library = 'competitor'` can never be referenced in `content_items.media_paths`; the render worker checks this too.
- A partial unique index on `schedules(content_item_id)` for statuses `scheduled`, `publishing` and `published` enforces one publication per item.

**Content item states:** `draft` → `approved` or `discarded`; then `approved` → `scheduled` → `publishing` → `published`, or `failed` → back to `scheduled` when the user reschedules.

**Job states:** jobs run through `pg-boss` in Postgres: `created` → `active` → `completed`, or `failed` with up to 3 retries and backoff, then a dead-letter queue that alerts the user.

## 7. Security, compliance, costs and retention

**Security**

- Supabase Auth with email login and MFA; roles `owner` and `editor`.
- Only `web` accepts inbound traffic. Workers have no public ports and talk to Postgres and Storage over TLS.
- Meta, AI and provider tokens are kept in Supabase Vault or Fly secrets, never in the browser. Meta long-lived tokens are refreshed before they expire.
- Media is served through short-lived signed URLs.

**Compliance**

- Everything runs in Frankfurt, in the client's accounts.
- Every asset records its library and rights status; competitor items cannot be rendered into output.
- Generated ads may need an AI-content label under Meta's rules; this is checked before ads go live.
- Competitor collection depends on the platforms' terms; the contract leaves that decision to the client.

Music comes only from the music library, which starts with a preloaded Pixabay Music set and accepts Adrián's own tracks with their licence, and a track without a royalty-free licence on record cannot be selected. Instagram's own music library is not available to posts published through the API, so music is rendered into the file. Royalty-free tracks can still trigger automatic copyright claims, which is why each track keeps its licence on record.

**Costs**

- The client pays AI, video generation, data provider, hosting and ad spend directly.
- Every job records its provider units and cost in `usage_costs`; a monthly limit in settings stops new paid jobs when reached.
- Workers scale to zero when the queue is empty.

**Retention**

| Data | Kept for |
| --- | --- |
| Owned uploads and approved items | Until the user deletes them |
| Discarded drafts | 7 days |
| Competitor search results not downloaded | 7 days |
| Downloaded competitor items | Until the user deletes them |
| Job records | 30 days |
