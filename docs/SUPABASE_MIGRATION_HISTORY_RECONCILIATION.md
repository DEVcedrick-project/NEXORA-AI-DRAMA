# Supabase migration history reconciliation

## Read-only inventory (2026-11-28)

The linked NEXORA AI DRAMA Supabase project reports these 28 applied migration versions:

| Version | Applied migration |
|---|---|
| 20261125040906 | secure_rls_auto_enable_function |
| 20261125040917 | create_secure_wallet_baseline |
| 20261125041019 | create_public_drama_catalog |
| 20261125041522 | lock_public_drama_catalog_to_read_only |
| 20261125042623 | explicit_deny_client_access_wallet_entitlements |
| 20261125093440 | create_nexora_push_devices |
| 20261125093500 | create_nexora_push_event_dedupe |
| 20261125101807 | lock_down_push_tables_rls |
| 20261125141817 | create_nexora_shared_social_features |
| 20261127022314 | nexora_social_deny_client_access |
| 20261127022827 | secure_push_device_identity |
| 20261127031947 | atomic_push_device_registration |
| 20261127033930 | atomic_social_comment_rate_limit |
| 20261127034051 | atomic_push_broadcast_claims |
| 20261127041718 | atomic_social_reactions |
| 20261127082828 | add_push_delivery_progress |
| 20261127112455 | fix_push_device_registration_regex_validation |
| 20261127121132 | add_push_registration_rate_limit |
| 20261127121219 | enforce_push_token_account_ownership |
| 20261127121421 | allow_terminal_push_delivery_failure_state |
| 20261127122139 | index_social_comment_user_rate_limit |
| 20261127122413 | social_read_request_rate_limit |
| 20261127143619 | nexora_social_shared_network_rate_limits |
| 20261127143817 | nexora_social_request_limit_retention |
| 20261127145201 | nexora_social_comment_keyset_index |
| 20261127150042 | nexora_push_stale_device_cleanup |
| 20261127151611 | nexora_push_authenticated_unregister |
| 20261127152344 | nexora_push_ambiguous_delivery_state |

The checked-in `main` branch's `supabase/migrations/` directory currently contains only:
- `20261127082828_add_push_delivery_progress.sql`
- `20261127112455_fix_push_device_registration_regex_validation.sql`

## Risk and required handling

This is migration-history drift: 26 applied migration records do not have corresponding migration files in the current `main` tree. The two present files are not a complete reproducible history. The live database's applied versions are authoritative evidence of what ran, but migration names alone are not sufficient to reconstruct their SQL safely.

Do **not**:
- fabricate historical SQL from migration names;
- delete or rewrite applied migration records;
- replay the missing migrations against production;
- run a blanket `db push` or reset to make the directory appear synchronized;
- combine this repair with unrelated NEXORA STUDIO or subscription changes.

## Safe reconciliation plan

1. Recover the exact SQL for each missing version from the original authoring commits, deployment artifacts, or trusted backups.
2. Verify each recovered file against the live schema, policies, indexes, constraints, functions, and triggers. The live `nexora_push_deliveries` status constraint currently permits `pending`, `sending`, `sent`, `invalid`, and `failed`; the initial checked-in progress migration does not describe that full state set.
3. Restore only verified historical files to source control, preserving their original version prefixes and exact SQL. Do not reapply them to the already-migrated project.
4. Confirm the repository migration inventory matches the database history, then run a dry-run diff against a disposable project before any production migration.
5. Only after reconciliation, implement the push lease/heartbeat and bounded retry repair as a new forward-only migration with corresponding worker changes and tests.

## Scope

Read-only inventory only. No database schema, migration records, data, RLS policies, secrets, device registrations, delivery statuses, or runtime settings were changed. No notifications were sent.
