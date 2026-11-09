---
title: Product vision
owner: product-manager
updated: 2026-11-09
---

# Product vision

Source: `docs/architecture/system-spec.md` (client specification, Nov 9, 2026).

## One-line pitch
For one brand that publishes on Instagram, a private web app that turns its own media library into ready-to-publish posts, carousels and Reels, learns from what works for competitors without copying their media, and publishes approved content on a calendar, optionally as an ad.

## Problem
Producing a steady flow of on-brand Instagram content takes hours of selecting media, writing hooks and captions, editing Reels and scheduling. Studying what performs for competitors is manual and scattered across Instagram, TikTok and YouTube.

## Target users and markets
One brand (single tenant), its Instagram Business account and Meta ad account. Spanish market, time zone Europe/Madrid; all data in the EU (Frankfurt), in the client's own accounts.

## Value proposition
- Three processes in one place: generate from the library, discover competitor content, schedule and publish.
- Unlimited volume: cost is controlled by the client's spending limits on the providers, not by app quotas.
- Safe by design: competitor media is never reused, nothing is published without approval, each item publishes once.

## Goals for the first release
| Goal | Metric | Target | By |
|---|---|---|---|
| Generate reviewable variants from the library | Variants approved without manual editing outside the app | to be set with the client | first release |
| Discover and download competitor references | Ranked results across the chosen platforms | top N per search | first release |
| Publish on schedule | Scheduled items published on time, once | 100 % | first release |

## Principles
- Rights first: competitor items are references only; third-party clips need cleared rights; music only with a licence on record.
- The human approves; the system never publishes on its own initiative.
- Every provider is replaceable from Settings; every paid call is recorded.

## Constraints
- Single tenant; Supabase and Fly.io in Frankfurt; the client pays AI, data, hosting and ad spend directly.
- Platform terms may restrict collecting competitor content; using that function is the client's decision.

## Out of scope for now
Multiple brands or accounts, platforms other than Instagram for publishing, in-app editing beyond captions, text and regenerating single parts.
