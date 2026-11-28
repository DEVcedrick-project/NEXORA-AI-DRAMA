# NEXORA push reconciliation admin endpoint

This endpoint is for a separately authenticated operator console. It is not part of the Android app and must not be called with an anonymous or ordinary user session.

## Authorization

The Edge Function verifies the bearer token with Supabase Auth using the anon key, then requires one of these trusted `app_metadata` values:

- `nexora_push_admin: true`, or
- `roles` containing `nexora_push_admin`.

Do not put this role in `user_metadata`; users can edit their own user metadata. Assign the role only through a trusted server-side admin process or the Supabase Dashboard. The operator ID recorded in the audit row is taken from the verified Auth user ID, never from request JSON.

## Configuration

Set these Edge Function secrets before deployment:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXORA_ADMIN_ALLOWED_ORIGINS`: comma-separated exact HTTPS origins for the operator console. Leave unset to deny browser origins by default; non-browser requests still require a verified admin bearer token.

The Supabase function gateway JWT verification should remain enabled. The handler independently calls `auth.getUser` and checks trusted app metadata.

## API

- `GET /functions/v1/nexora-push-reconciliation-admin?limit=50`: lists up to 100 newest `unknown` deliveries. It returns opaque `delivery_id` values and operational metadata, never FCM registration tokens.
- `POST /functions/v1/nexora-push-reconciliation-admin`: body fields are `deliveryId`, `evidenceReference`, and `reason`. The operator identity is derived from the verified JWT.

Only an evidence-backed confirmation from `unknown` to `sent` is supported. There is no retry, resend, or requeue operation. If evidence is insufficient, leave the delivery in `unknown`.

## Deployment order

Apply candidate migrations in order through `20261128030000_nexora_push_reconciliation_admin_v1.sql`, then deploy this function and the separate operator console. Do not deploy to production until the PR is reviewed and explicitly approved.
