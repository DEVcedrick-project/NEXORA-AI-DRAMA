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


## Historical Git recovery check (2026-11-28 follow-up)

The migration-path commit history and historical trees were inspected. One of the two tracked migrations has an exact recoverable original:

- The delivery-ledger migration was first added in commit `e4780b37f522df2762951d108fad07ffd20af8e5` as `20261127162400_add_push_delivery_progress.sql`.
- In the next relevant commit, `d8dc9af9eee1b626ed9fafaa56b365b9b0e1a668`, it was renamed to `20261127082828_add_push_delivery_progress.sql` to match the applied Supabase version.
- Commit `f1508e804470db59a5137ebff61db0bc96c94891` removed the mismatched timestamp copy.
- The original SQL blob SHA is `2995769307442e8eea320223037fe68ebe598c29`. The renamed file in `main` has the same blob SHA, confirming byte-identical content.
- The original migration creates the private per-device delivery ledger with the initial `pending/sent/invalid` status check and service-role-only table grants. The live database's expanded status set reflects later schema evolution, so this original file must remain historical and must not be edited to imitate the current schema.

This recovery check does **not** recover the other 25 missing files. The inspected historical tree at the delivery-ledger commit also contained only this one migration file. No historical migration file has been restored or replayed as part of this follow-up. Continue searching other trusted authoring commits/artifacts for the remaining 25 exact SQL sources.


## Exact historical files recovered into this PR branch

A search of the repository's existing audit/fix branches found six additional migration files whose version prefixes exactly match six applied Supabase migration versions. Their file contents were copied byte-for-byte from the source branch blobs into this PR branch (new Git blobs may have different SHA values only if line-ending normalization occurred; source blob SHAs are recorded below for traceability):

| Applied version | Restored file | Original source branch | Original blob SHA |
|---|---|---|---|
| 20261127031947 | `20261127031947_atomic_push_device_registration.sql` | `fix/deep-nonsubscription-audit-2026-11-27` | `f33c0ba68aac375c427152a9ab355486f09420ef` |
| 20261127033930 | `20261127033930_atomic_social_comment_rate_limit.sql` | `fix/deep-nonsubscription-audit-2026-11-27` | `ec7f83ff692596be98af27b05fb642994caef490` |
| 20261127034051 | `20261127034051_atomic_push_broadcast_claims.sql` | `fix/deep-nonsubscription-audit-2026-11-27` | `a4ad501624360beff0d90e49445dab8c4488bc58` |
| 20261127041718 | `20261127041718_atomic_social_reactions.sql` | `fix/deep-nonsubscription-audit-2026-11-27` | `49d0c8f76de7c3aa1f41ae7d0a75f1cbb8551ca4` |
| 20261127143619 | `20261127143619_nexora_social_shared_network_rate_limits.sql` | `fix/deep-audit-nexora-2026-11-27` | `1cd19909f84344ab34320e2a079d6c081f6cc2ee` |
| 20261127143817 | `20261127143817_nexora_social_request_limit_retention.sql` | `fix/deep-audit-nexora-2026-11-27` | `18cb7972ef24f9ec058f245761827c831c06b3cb` |

These files were restored to source control only. They were **not** executed against Supabase. The registration migration is an earlier version of the registration RPC; the later applied regex-hardening migration remains in sequence and replaces it. The push-claim migration reproduces the currently inspected RPC definitions, including the known 15-minute claim and unconditional completion behavior; restoring history does not imply those behaviors are approved or repaired.

The live applied migration inventory is now matched by 8 source-controlled migration files (the original two plus these six). **20 applied migration files remain unrecovered.** The next recovery pass must resolve timestamp-mismatched candidate files individually against deployment evidence and live schema before restoring them. In particular, do not rename a candidate just because its purpose resembles a missing migration.


## Timestamp-mismatched candidates held back

Additional historical branches contain SQL candidates that must not yet be copied into the applied migration sequence:

- `20261127130000_index_social_comment_pagination.sql` and `20261127163000_nexora_social_comment_keyset_index.sql` both create the live `nexora_social_comments_series_created_id_idx` index. The latter also drops the old two-column index. The database records applied version `20261127145201`; the source timestamps do not match. The live index definition is consistent with the later candidate, but this is not enough to prove the exact deployed migration file/version mapping.
- `20261127170000_nexora_push_stale_device_cleanup.sql`, `20261127180000_nexora_push_authenticated_unregister.sql`, and `20261127190000_nexora_push_ambiguous_delivery_state.sql` resemble applied migrations `20261127150042`, `20261127151611`, and `20261127152344` by purpose, but their timestamps differ. Keep them as unverified candidates until commit/deployment evidence and complete live definitions establish exact correspondence.
- `20261127143000_prune_terminal_push_delivery_history.sql` was found on another branch, but its index/function are not present in the current live schema inspection and it is not in the applied migration inventory. It is not an applied migration recovery candidate.

No timestamp-mismatched candidate was restored. The six exact-version files listed above remain the only new restorations in this PR branch.


## Live-definition verification of three timestamp-mismatched candidates

Further read-only comparison against the live database confirms:

- Candidate `20261127170000_nexora_push_stale_device_cleanup.sql` defines `nexora_register_push_device`. Its function body matches the live function's token allowlist, strict UUID install ID, advisory-lock ordering, refusal to transfer a token across users, 180-day stale-device cleanup, five-device cap, and same-owner upsert.
- Candidate `20261127180000_nexora_push_authenticated_unregister.sql` defines `nexora_unregister_push_device`. Its body matches the live function's token/user validation and exact token-plus-user deletion.
- Candidate `20261127190000_nexora_push_ambiguous_delivery_state.sql` changes the delivery status constraint to `pending/sending/sent/invalid/failed` and documents ambiguous `sending` outcomes. Both the live check constraint and the live column comment match this candidate.

The corresponding applied migration versions are recorded as `20261127150042`, `20261127151611`, and `20261127152344`, respectively, so the candidate filenames still do not match the migration ledger versions. Function/schema equivalence is strong corroborating evidence of deployed content, but it does not establish the exact historical version-to-file mapping. **These three files remain un-restored pending an authoritative Git rename/commit or deployment record that maps each exact SQL blob to its applied version.** No SQL was executed and no production changes were made.


## Additional unregister-function privilege check

A read-only privilege check of the live `nexora_unregister_push_device(text,text)` function found:

- It is `SECURITY DEFINER`, owned by `postgres`, with `search_path=public`.
- Its function ACL grants execute only to `service_role` (and the owner); there is no execute grant to `anon` or `authenticated`.
- The `public` schema does not grant `CREATE` to `anon`, `authenticated`, or `service_role`; only `postgres` has `CREATE` in the inspected role set.

This reduces the immediate public-schema object-shadowing concern for the current privilege configuration, but the non-empty search path remains a hardening opportunity. Do not alter the live function as part of historical recovery. Any future hardening should be a separately reviewed forward-only migration that preserves the service-role-only execution contract and verifies all referenced objects are schema-qualified. No production change was made.
