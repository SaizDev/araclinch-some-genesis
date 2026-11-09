# Deploy and rollback

Owner: devops-engineer. Production changes start only when the human types `send to production`.

## Normal release (`/spec-ship`)
1. The human tested the spec locally (`pnpm dev` against the development Supabase project) and typed `send to production`.
2. `pnpm verify` passes on the feature branch.
3. If the spec has a change script, it is released to the production project first (one transaction).
4. The branch is merged into `main` and pushed. The changed workers are deployed to their production Fly apps (`fly deploy --remote-only --app <app> --config workers/<worker>/fly.toml`, one at a time). The web app host is not decided yet; until it is, the human deploys it.
5. `/db-snapshot` refreshes `migrations/schema.sql` when the schema changed.
6. Smoke test: sign in, the main flows of the spec, `GET /api/health`.

New production environment variables are set by the human (`fly secrets set`, web host settings) before step 1.

## Rollback
- **Workers:** `fly releases --app <app>`, then the human runs `fly deploy --image <previous image> --app <app>` (agents need `send to production` for it). **Web app:** per its host. Then revert the merge commit in git through a bugfix spec.
- **Database:** a released change is reversed by a new spec whose change script undoes it. For data loss use Supabase backups or point-in-time recovery.

## Preview deployments
Workers in development: deploy the `-dev` apps at any time; they use the development Supabase project and development keys.
