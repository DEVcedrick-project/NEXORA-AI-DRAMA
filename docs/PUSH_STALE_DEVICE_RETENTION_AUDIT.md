# Push device stale-registration and retention audit

## Scope
NEXORA AI DRAMA push registration and update-broadcast paths only. No NEXORA STUDIO, subscriptions, billing, Firebase project settings, or production data changes.

## Findings

### 1. No explicit unregister path is present
The native client registers an FCM token through `nexora-push-register`, but no corresponding unregister request or FCM token deletion call appears in the client source. Sign-out/account-switch flows re-register the current token for the new Firebase UID; they do not explicitly detach the previous account's registration.

The registration endpoint verifies the Firebase ID token and derives `user_id` from that token. The database RPC `nexora_register_push_device` is responsible for ownership and device limits, but its SQL definition is absent from this repository, so its exact transfer behavior cannot be confirmed.

### 2. Stale registrations are removed only after FCM reports UNREGISTERED
The broadcast removes a token when FCM returns `UNREGISTERED`. No `last_seen_at`, `last_registered_at`, heartbeat, expiry timestamp, or scheduled cleanup job is visible in this repository. A device offline for months can therefore remain registered while its FCM token remains valid, potentially consuming the five-device account limit.

Do not delete devices solely because they have not received a push recently: delivery attempts and device activity are different signals.

### 3. Delivery history has no visible retention policy
The `nexora_push_deliveries` table has no retention/partition policy or cleanup job in this repository. Old event rows can grow without bound. Cleanup must preserve idempotency for the supported event replay window.

### 4. Server-side database RPC definitions are missing
The repository calls `nexora_register_push_device`, `nexora_check_push_registration_rate_limit`, `nexora_claim_push_event`, `nexora_release_push_event`, and `nexora_complete_push_event`, but their SQL definitions are not present. Do not deploy schema-dependent cleanup until the live definitions and constraints are reviewed.

## Recommended safe follow-up
1. Add a server-only unregister endpoint that verifies the Firebase ID token and deletes only the matching `app_id + token + user_id` row. Invoke it on explicit sign-out only after push notifications are no longer needed for that account; do not remove a token during account switch until registration for the new account succeeds.
2. Add a server-maintained `last_registered_at` or heartbeat timestamp, updated only by verified registration. Use a conservative retention window and a dry-run report before deleting inactive registrations.
3. Add a scheduled, server-only retention job for delivery history after the maximum event replay window, retaining enough event identity to prevent duplicate broadcasts.
4. Test sign-out, account switch, token rotation, reinstall, long-offline devices, and a token reassigned while a broadcast is in flight.

## Validation boundary
This is a repository-source audit, not a production database inspection. Actual Supabase schema, RPC bodies, scheduled jobs, and live device rows were not accessible from the checked repository files. No production cleanup was run.
