# Incident response

Owner: devops-engineer with security-auditor.

1. **Detect and declare:** note time, symptoms, affected users. Create an incident note in `docs/runbooks/incidents/YYYY-MM-DD-title.md`.
2. **Stabilize:** roll back the application (see deploy-and-rollback.md), disable the feature flag, or scale down the failing integration.
3. **Investigate:** web host logs, worker logs (`fly logs --app <app>`), the pg-boss failed and dead-letter jobs, Supabase logs and advisors, recent deploys and migrations.
4. **Security incidents:** rotate affected secrets immediately (secrets-rotation.md), revoke sessions if accounts may be compromised, preserve logs. Personal data breach under GDPR: the human notifies the supervisory authority within 72 hours when required.
5. **Fix:** create a bugfix spec (`/spec-new`) with the root cause and a regression test; follow the normal flow with expedited human approval.
6. **Review:** blameless post-incident notes: timeline, root cause, what worked, action items as specs.
