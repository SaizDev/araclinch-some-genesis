# Roadmap

Maintained by the product-manager; the orchestrator updates statuses. Order = priority. Source: `docs/architecture/system-spec.md`. The Meta integration comes last so generation can be tested without it; Meta business verification is requested at the start because it can take days.

| Spec | Type | Title | Status | Notes |
|---|---|---|---|---|
| 000 | feature | Foundation: workspace, auth, data model core, queue, worker skeleton | draft | Run the intake and approve before any other work |
| 001 | feature | Starting library: Instagram export ZIP import and asset analysis | planned | worker-media |
| 002 | feature | Brand profile, templates and music library | planned | |
| 003 | feature | Process 1: generate variants, review and approve | planned | worker-agent, worker-render, provider adapters |
| 004 | feature | Process 2: discover, rank and download competitor content | planned | worker-discovery |
| 005 | feature | Settings: providers, spending limit and costs | planned | |
| 006 | feature | Process 3: calendar and publishing to Instagram | planned | Meta app; worker-publish |
| 007 | feature | Run as ad | planned | Marketing API |
| 008 | feature | Insights and feedback into planning | planned | worker-analytics |
