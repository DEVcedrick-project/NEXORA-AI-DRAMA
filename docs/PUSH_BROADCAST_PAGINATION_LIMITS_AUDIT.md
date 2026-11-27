# Push broadcast pagination and delivery-limit audit

## Scope
NEXORA AI DRAMA push broadcast path only. No NEXORA STUDIO, subscriptions, billing, production data, or deployment changes.

## Findings

### 1. Eligible devices are fetched without pagination
The broadcast selects every eligible Android device row from `nexora_push_devices` in one Supabase query. There is no explicit `range()`, keyset cursor, or bounded page size. Depending on the project's PostgREST maximum-row setting, a large audience can be silently truncated by the API response limit. The code then seeds delivery progress only for the rows it received, so omitted devices may never be included in that event.

### 2. Delivery progress is also read without pagination
The pending delivery query selects every pending token for the event without a page limit or cursor. Large events can exceed the API row cap and leave some pending rows unprocessed even though the function may mark the event complete after processing the returned subset. This is a correctness risk, not just a performance concern.

### 3. Work is unbounded and sequential
The function upserts the full progress seed in one request and sends FCM requests one at a time in a single loop. There is no explicit maximum batch size, bounded concurrency, checkpointed page loop, or execution-time budget. A large audience can consume substantial memory and exceed the Edge Function execution window.

### 4. Attempt count has no visible ceiling
The code increments `attempt_count` but does not enforce a maximum retry count or classify retryable versus permanent FCM errors. A repeatedly failing token or systemic error can keep an event pending and cause repeated full-event retries.

## Recommended repair design

1. Use keyset pagination with a stable unique key for device discovery, and persist all discovered recipients into the event ledger before delivery begins. Do not treat a partially fetched recipient list as complete.
2. Page pending ledger rows using a stable composite cursor (for example, token) and process a bounded page per invocation.
3. Keep event claim ownership across page processing using a lease/heartbeat or durable continuation state. Only call the completion RPC after a database-side check confirms there are no pending rows and all recipient discovery pages were exhausted.
4. Use bounded concurrency for FCM sends with per-token status updates; avoid one giant request payload or unbounded Promise.all.
5. Add explicit retry classification, exponential backoff, and a maximum attempt policy. Preserve pending status for transient errors; move permanent token errors to invalid only when FCM's error code establishes that the token is no longer registered.
6. Add tests above the configured PostgREST row limit, above one processing page, with partial failures across page boundaries, and with a function timeout between pages.

## Required database review before implementation
The SQL bodies for `nexora_claim_push_event`, `nexora_release_push_event`, and `nexora_complete_push_event` are absent from this repository. Their lease, completion, and idempotency semantics must be reviewed before implementing multi-invocation pagination. The deployed PostgREST max-rows setting and Edge Function execution limits must also be confirmed.

## Validation boundary
This is a source-level audit. No live Supabase settings, database RPC bodies, device rows, FCM calls, or deployed functions were inspected or changed. No build or production test was run.
