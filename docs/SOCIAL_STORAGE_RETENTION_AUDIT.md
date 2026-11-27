# NEXORA AI DRAMA social storage and retention audit

## Scope
NEXORA AI DRAMA social tables and `nexora-social` Edge Function only. This is a read-only audit; no production rows, schema, settings, or functions were changed.

## Verified live database findings

### 1. Comment pagination is bounded and indexed
The Edge Function requests 21 rows, returns at most 20, and uses a composite descending cursor over `created_at` and `id`. The live database has the matching index `(series_id, created_at DESC, id DESC)`. A separate `(user_id, created_at DESC)` index supports per-user recent-comment checks.

### 2. Social tables are not directly exposed to client roles
The live database reports RLS enabled on comments, likes, saves, and read-limit rows. Direct SELECT is not granted to `anon` or `authenticated`; service-role access is available. Comments, likes, and saves also have deny-client policies. The read-limit table has no client policy, but RLS is enabled and client SELECT is not granted.

### 3. Read-limit records have no observed retention mechanism
`nexora_check_social_read_rate_limit` stores one row per Firebase user ID and updates it on every read request. It resets the counter after one minute, but does not delete old user rows. The live project does not currently have the `pg_cron` extension installed. This means the table can retain stale per-user records indefinitely as distinct user IDs accumulate.

### 4. User-generated comments have no retention or per-series cap
`nexora_create_social_comment` enforces at most five comments per user per 60 seconds using a transaction advisory lock. The comments table has useful lookup indexes, but no retention policy, per-user lifetime cap, or per-series cap was found in the inspected function/schema. Whether comments should expire is a product decision; automatic deletion must not be introduced without an explicit retention requirement.

### 5. Current observed data volume is small
The live database statistics estimate one comment row and one read-limit row. These figures are current estimates, not capacity guarantees. Table total sizes include indexes and storage overhead.

## Recommended follow-up

1. Add a bounded cleanup strategy for stale `nexora_social_read_limits` rows (for example, a scheduled job that deletes rows whose `updated_at` is older than a conservative retention window). Confirm the scheduling mechanism and permissions before deployment; `pg_cron` is not currently installed.
2. Keep comment retention as an explicit product decision. If indefinite history is intended, retain it and monitor table/index growth. If retention is desired, define the period and user-facing behavior before writing a deletion migration.
3. Add a test for the read-limit reset boundary and for cleanup being restricted to stale rows.
4. Monitor table size, live/dead tuple estimates, and index growth as usage increases.

## Validation boundary
The live database was queried read-only for function definitions, indexes, RLS flags/policies, role privileges, approximate row statistics, and installed extensions. No cleanup, DDL, data mutation, deployment, or production setting change was performed.
