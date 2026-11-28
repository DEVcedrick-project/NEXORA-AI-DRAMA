# NEXORA push reconciliation admin endpoint

This endpoint is for a separately authenticated operator console. It is not part of the Android app and must not be called with an anonymous or ordinary user session.

## Authorization
The Edge Function verifies the bearer token with Supabase Auth, then requires trusted `app_metadata.nexora_push_admin = true` or `app_metadata.roles` containing `nexora_push_admin`. User-editable `user_metadata` is ignored. The audit operator ID is derived from the verified Auth user.

## Rate limits and request bounds
A service-role-only, database-backed fixed-window limiter applies across Edge Function instances:
- GET listing: 20 requests per verified admin per minute; 120 requests globally per minute.
- POST reconciliation: 5 requests per verified admin per minute; 30 requests globally per minute.
- Limit violations return HTTP 429 with `Retry-After: 60`; limiter/database failures fail closed with HTTP 503.
- POST bodies are streamed and capped at 8 KiB. Client-supplied IP/forwarded headers are not trusted for identity or quotas.

## Configuration
Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally `NEXORA_ADMIN_ALLOWED_ORIGINS` (comma-separated exact HTTPS origins). Keep Edge Function gateway JWT verification enabled.

## API
- `GET /functions/v1/nexora-push-reconciliation-admin?limit=50`: lists up to 100 newest unknown deliveries with opaque IDs only; never returns FCM registration tokens.
- `POST /functions/v1/nexora-push-reconciliation-admin`: requires `deliveryId`, `evidenceReference`, and `reason`.

Only evidence-backed `unknown` → `sent` is supported. There is no retry, resend, or requeue action. Do not deploy until candidate migrations are reviewed and explicitly approved.
