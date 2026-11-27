# Push delivery v2 design

Status: design only; not deployed or applied

## Scope

This design applies only to the NEXORA AI DRAMA release-update broadcaster. It does not change NEXORA STUDIO, subscriptions, user-facing app behavior, or Firebase credentials.

Production was inspected read-only on 2026-11-28. The live tables currently expose:

- `nexora_push_events(event_key, episode_id, created_at, claim_token)`
- `nexora_push_deliveries(event_key, token, status, attempt_count, last_attempt_at, sent_at, created_at, updated_at)`
- Delivery status values: `pending`, `sending`, `sent`, `invalid`, `failed`
- Delivery primary key: `(event_key, token)`

The active worker is production version 17. Its exact source is now tracked in this branch. Keep its pre-send `sending` transition, concrete-rejection return to `pending`, FCM `collapse_key`, and Android notification `tag`.

## Required schema additions

Additive, forward-only columns:

- `nexora_push_events.lease_expires_at timestamptz`
- `nexora_push_deliveries.next_attempt_at timestamptz not null default now()`
- `nexora_push_deliveries.last_error_code text`

Backfill existing claimed events to `created_at + interval '15 minutes'`. Do not reinterpret a null `claim_token`: it represents a completed/released event under the existing contract and must not be reclaimed by the new claim path.

Indexes:

- Partial index on `(event_key, next_attempt_at, token)` for `status = 'pending'`
- Partial index on `(event_key, updated_at, token)` for `status = 'sending'` to support stale/ambiguous inspection

Do not add a retry column or status value without checking the live constraint and migration ledger again at implementation time.

## RPC contract

Introduce versioned RPC names so the current production v17 worker remains compatible during rollout:

1. `nexora_claim_push_event_v2(event_key, claim_token, lease_seconds)`
   - Validate bounded event key, token, and lease duration.
   - Insert the event row for a first claim.
   - On conflict, take over only when an existing non-null claim token has an expired lease.
   - Never steal a live lease or reclaim a row whose claim token is null.
   - Set both claim token and lease expiry atomically.

2. `nexora_renew_push_event_v2(event_key, claim_token, lease_seconds)`
   - Extend only the currently owned, unexpired lease.
   - Return false for stale, expired, or mismatched tokens.

3. `nexora_complete_push_event_v2(event_key, claim_token)`
   - Clear the claim only if the token matches and no delivery remains `pending` or `sending`.
   - Return false while work remains.

4. `nexora_release_push_event_v2(event_key, claim_token)`
   - Release only a matching lease.
   - Must not erase delivery history or permit a stale worker to clear a newer claim.

All functions must use an empty `search_path`, schema-qualify objects, be SECURITY DEFINER only where required, and grant EXECUTE only to `service_role`. Verify ACLs after migration.

## Worker contract

- Fetch eligible devices in deterministic bounded pages (target 100; maximum 250).
- Seed delivery rows idempotently.
- Select only `pending` rows whose `next_attempt_at <= now()`, with a stable keyset cursor.
- Persist `sending` and increment `attempt_count` before FCM. Keep a per-attempt lease/claim ownership guard on every state transition.
- Renew the event lease before it approaches expiry and between pages.
- For a confirmed FCM acceptance, transition `sending -> sent`.
- For `UNREGISTERED`, transition `sending -> invalid` and delete only the matching Android app registration.
- For explicit retryable rejections, transition `sending -> pending`, store a sanitized code, and set `next_attempt_at` using capped exponential backoff with jitter.
- For permanent rejections or exhausted attempts, transition to `failed`.
- For network timeouts, process termination, or lost responses, keep the outcome explicitly ambiguous; do not blindly reset `sending` to `pending`. A later reconciler must use a deliberate ambiguity policy before retrying.
- Complete only after the database RPC confirms there are no `pending` or `sending` rows.

## Required tests before deployment

- Concurrent first claims: exactly one succeeds.
- A live lease cannot be stolen; an expired lease can be taken over.
- Renewal requires the current token and an unexpired lease.
- Old token cannot renew, release, complete, or mutate a newer owner's delivery.
- Completion is rejected while any row is pending or sending.
- Pagination has stable ordering, bounded page size, and no duplicate/omitted tokens across page boundaries.
- Backoff increases, is capped, includes jitter, and never exceeds the attempt ceiling.
- Retryable FCM rejection returns to pending; permanent rejection becomes failed; UNREGISTERED becomes invalid.
- Timeout/ambiguous send is not automatically retried.
- Partial success followed by failure does not resend already-sent tokens.
- Duplicate invocations coalesce through the same event key and Android collapse/tag behavior.

## Rollout sequence

1. Reconcile migration history for the target schema; do not guess migration timestamps.
2. Add a new forward-only migration and test it on a disposable Supabase project.
3. Verify RPC security/ACLs and exercise concurrency tests against PostgreSQL.
4. Deploy the additive RPC/schema migration.
5. Deploy the successor worker only after its source is reviewed against production v17.
6. Verify a dry-run or controlled test event and monitor delivery counts and oldest pending/sending age.
7. Retain a rollback path that restores the v17 worker without dropping the additive schema.

No schema changes or function deployments were performed as part of this design.
