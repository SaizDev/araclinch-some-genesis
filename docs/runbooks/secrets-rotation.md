# Secrets rotation

Human-only procedure. Agents may prepare the checklist but never handle secret values.

| Secret | Where it is used | How to rotate |
|---|---|---|
| Supabase secret key | Web host env and worker Fly secrets `SUPABASE_SECRET_KEY` (server) | Supabase dashboard > Project Settings > API keys: create a new secret key, update the web host env and `fly secrets set` on each worker app, then revoke the old key |
| Supabase publishable key | Web host env `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same flow; public but rotate after abuse |
| Database password | GitHub environment secret `SUPABASE_DB_PASSWORD` | Supabase dashboard > Database settings > reset password; update the GitHub secret |
| Supabase access token (CI) | GitHub environment secret `SUPABASE_ACCESS_TOKEN` | Supabase account > Access tokens: create new, update GitHub, delete old |
| Third-party API keys (Anthropic, Veo, Kling, ElevenLabs, Apify, YouTube) | Fly secrets of the workers that use them | Provider dashboard; `fly secrets set` on each app (restarts it); revoke old |
| Meta app secret | Fly secrets (publish, analytics) | Meta app dashboard; update secrets; page tokens in Vault stay valid |
| Meta page and ad account tokens | Supabase Vault | Reconnect in Settings; the publish worker refreshes long-lived tokens |

After rotation: redeploy, run the smoke test, and record the rotation date here.

| Date | Secret | Reason | By |
|---|---|---|---|
