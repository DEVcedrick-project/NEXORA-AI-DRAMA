# Push database security and live-state follow-up

## Scope

Read-only inspection of the live NEXORA AI DRAMA Supabase project `vureiymqoosubwubhvdu` on 2026-11-28. No database writes, function deployments, notification sends, or secret reads were performed.

## Verified live RPC security

The following public RPCs were inspected using PostgreSQL catalog metadata and their definitions:

- `nexora_claim_push_event(text, text)`
- `nexora_release_push_event(text, text)`
- `nexora_complete_push_event(text, text)`

All three are **SECURITY INVOKER**, set an empty `search_path`, and are executable by `service_role` but not by `anon` or `authenticated`. This is a positive least-privilege result; preserve it when replacing the RPCs. Do not convert these functions to SECURITY DEFINER as a shortcut.

The live claim RPC atomically inserts or takes over an event row only when the existing non-null claim is older than 15 minutes. The live completion RPC only checks event key and claim token before clearing the token; it does not check delivery rows. The release RPC deletes the event row only when both key and token match. These details confirm the audit findings and should be accounted for in any replacement design.

## Verified table controls and indexes

- RLS is enabled on `nexora_push_devices`, `nexora_push_events`, and `nexora_push_deliveries`.
- `nexora_push_devices` and `nexora_push_events` have explicit deny-all policies for `anon` and `authenticated`.
- No client policy was present for `nexora_push_deliveries`; with RLS enabled, no client policy means client roles receive no row access through RLS. Keep delivery-ledger access service-only.
- RLS is not forced on these tables. Do not change that without checking the service-role/owner execution model and validating all existing operational paths.
- Existing useful indexes include delivery `(event_key, status)`, delivery primary key `(event_key, token)`, device `last_seen_at DESC`, device primary key `(token)`, and a partial device `user_id` index.

## Point-in-time operational baseline

As of this read-only inspection:
- 58 push event rows existed; none had a non-null claim token.
- The delivery ledger contained 8 rows, all with status `sent`.
- No `pending`, `sending`, `failed`, or `invalid` delivery rows were present in the grouped status count.

This is a point-in-time snapshot, not proof that historical notifications were delivered to or displayed by end-user devices. FCM acceptance is not equivalent to device receipt or user-visible display.

## Required implementation constraints

1. Preserve SECURITY INVOKER, empty search_path, and service-role-only RPC execution.
2. Add lease ownership/expiry/heartbeat and completion checks without exposing the RPCs to client roles.
3. Keep all delivery ledger reads/writes server-side; never expose raw device tokens in diagnostics.
4. Keep invalid-token cleanup scoped to the NEXORA AI DRAMA app identifier and exact token.
5. Add tests for RPC privilege boundaries and RLS in addition to concurrency and retry behavior.
6. Keep migration repair and the worker deployment coordinated; do not run migrations against production until the missing historical migration source is reconciled.

## Safety status

Read-only audit only. Production schema, data, RLS, grants, secrets, registrations, delivery statuses, Edge Function versions, and runtime settings were not changed. NEXORA STUDIO and subscription systems were not inspected or modified.
