# Social read-rate-limit retention

## Finding

The read limiter stores one row per Firebase UID in `public.nexora_social_read_limits`. The live table had only a small number of rows during the audit, but the function `public.nexora_check_social_read_rate_limit` never removes inactive users. The table had only its primary-key index, so a retention sweep would otherwise become progressively more expensive.

## Proposed repair

`supabase/maintenance/social_read_limit_cleanup.sql` adds:

- An index on `updated_at` for bounded stale-row selection.
- A privileged function in the non-exposed `private` schema.
- A strict 24-hour minimum age, so active rate-limit windows are never eligible.
- A hard batch limit of 500 rows, ordered oldest first, using `FOR UPDATE SKIP LOCKED` to coexist with concurrent requests and cleanup workers.
- Execution permission only for `service_role`; no client role can call it.

The cleanup touches only `nexora_social_read_limits`. It does not delete comments, likes, saves, accounts, or push registrations.

## Rollout requirements

- This repository's live Supabase project did not have `pg_cron` installed during the audit. Therefore this PR does **not** claim automatic cleanup is scheduled.
- Review and deploy the SQL through the project's normal migration process.
- Configure a trusted scheduler (for example, an external scheduled job using the service-role key) to call `private.nexora_cleanup_social_read_limits(now() - interval '24 hours', 250)` periodically. Keep the service-role key server-side only.
- Alert on repeated failures and monitor rows deleted per run. Multiple runs may be needed to drain a backlog; each invocation is deliberately bounded.
- Verify the function rejects cutoffs newer than 24 hours and batch sizes outside 1–500 before enabling the scheduler.

## Safety status

No production schema, data, scheduler, or environment settings were changed by this proposal. No live cleanup was executed. The SQL is a reviewed candidate, not yet deployed.
