# Push delivery lease and retry audit

## Scope

Read-only inspection of the NEXORA AI DRAMA push broadcast Edge Function and the live Supabase push-event RPC definitions. No production data, schema, secrets, device registrations, or delivery statuses were modified.

## Confirmed findings

1. **Claim expiry is a fixed 15-minute timeout, not a renewable lease.** `nexora_claim_push_event` takes over an existing claim when `created_at` is older than 15 minutes. The broadcast worker can process an unbounded number of devices sequentially, so a slow/large batch can outlive that timeout. A second worker may then claim the same event while the first is still sending.
2. **Partial failure can strand the event until timeout.** The worker only releases its claim in the catch path when `deliveredThisAttempt === 0`. If one or more sends succeeded before a later failure, the claim is intentionally left behind; the event cannot resume until the 15-minute expiry.
3. **Completion does not verify delivery terminal states.** `nexora_complete_push_event` clears the claim when the claim token matches. It does not check whether any `pending` or `sending` deliveries remain.
4. **The worker reads all eligible devices and all pending deliveries in unbounded queries.** There is no explicit page size or cursor. This increases memory/runtime risk as registrations grow.
5. **No retry ceiling or retry schedule is enforced in the worker.** Attempts are incremented, but the worker selects every `pending` row and has no maximum-attempt filter or backoff. Transient failures throw and stop the batch; non-UNREGISTERED permanent FCM errors are not classified into a terminal state.
6. **Live schema differs from the checked-in initial delivery migration.** The live `nexora_push_deliveries` status constraint allows `pending`, `sending`, `sent`, `invalid`, and `failed`, while the repository migration that initially creates the table lists only `pending`, `sent`, and `invalid`. Reconcile migration history before changing the status machine; do not assume the checked-in migration alone describes production.

## Recommended coordinated repair

- Replace timestamp-based stale takeover with an explicit lease model: `lease_expires_at`, owner token, and lease renewal/heartbeat while a worker is active. Claims and renewals must be atomic and token-checked.
- Make completion conditional: only clear/complete the event when no delivery remains `pending` or `sending`; report incomplete state otherwise.
- Use bounded pages (for example, 100–250 tokens) and persist a per-page cursor/progress checkpoint. Keep each invocation within platform runtime limits.
- Apply a finite attempt ceiling (for example, 5) with exponential backoff and jitter for retryable failures. Persist `next_attempt_at`, a sanitized error code, and terminal `failed` status for exhausted/permanent failures.
- Treat FCM `UNREGISTERED` as terminal `invalid` and remove only the matching app's device registration; classify other FCM error codes explicitly rather than treating all as retryable.
- Make per-delivery transitions compare-and-set (expected prior status and claim token/lease owner) to prevent a stale worker overwriting a newer attempt.
- Add tests for concurrent claims, lease renewal/expiry, partial success then failure, duplicate worker execution, pending deliveries blocking completion, bounded pagination, retry backoff/ceiling, invalid-token cleanup, and permanent FCM errors.

## Rollout safety

This is an audit-only change. Do not deploy a partial Edge Function-only patch: the database claim/complete RPCs and worker must change together. Before rollout, reconcile live schema/migration history, run database and Edge Function tests, deploy the RPC migration first, then deploy the worker, and monitor pending/sending/failed/invalid/sent counts plus oldest pending age. No notification should be replayed solely because a worker's lease expired without first checking persisted per-token state.


## Production deployment comparison (2026-11-28)

The active Supabase Edge Function `nexora-push-broadcast` was inspected read-only. Production reports version **17** and status **ACTIVE**. Its deployed source is not identical to the worker file currently checked into this PR branch.

Production version 17 already includes several safeguards absent from the PR branch copy:
- marks a delivery `sending` before the FCM network call;
- changes a concrete non-UNREGISTERED FCM rejection back to `pending` before returning an error;
- uses FCM `collapse_key` and Android notification `tag` keyed by the release event to coalesce duplicate update notifications.

This means the checked-in worker is stale relative to the active deployment, and any future worker repair must first reconcile the exact deployed version-17 source into source control or intentionally replace it with a reviewed successor. Do not deploy the branch copy over production: it would regress the `sending` transition and collapse behavior.

The production source still reads all eligible devices and pending deliveries without pagination, has no finite attempt ceiling or persisted retry schedule, uses the fixed claim timeout, and completes without a database-side check that all deliveries are terminal. Its catch path also retains the claim after any successful send in the current invocation, so partial progress can remain blocked until claim expiry. The `sending` state makes uncertain outcomes more visible; it does not by itself resolve or safely retry them.

This comparison was read-only. No function was deployed, no secrets were read, and no notification was sent.
