# Git and delivery

- One branch per spec: `feat/NNN-slug`, `fix/NNN-slug` or `chore/NNN-slug`. The branch name activates the spec for the hooks.
- Conventional Commits with the spec id as scope: `feat(003): add invoice export`, `fix(012): handle empty cart`.
- Commit the change script and `src/types/database.types.ts` with the code that uses them.
- No force pushes; no `--no-verify`. Feature branches may be pushed at any time.
- `main` is production (the web host deploys it once hosting is chosen). Merging into `main` and pushing it are blocked until the human types `send to production`; then `/spec-ship` releases the database change, merges, pushes, deploys the changed workers (`fly deploy --remote-only --app <worker>`) and saves `migrations/schema.sql`.
- Fly.io: development apps (`<worker>-dev`) can be deployed at any time; production apps only in `/spec-ship` (hooks enforce it).
