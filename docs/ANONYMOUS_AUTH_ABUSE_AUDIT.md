# Anonymous Firebase Account Creation Abuse Audit

**Scope:** NEXORA AI DRAMA only. This audit does not change NEXORA STUDIO, subscriptions, checkout, payment flows, Firebase project settings, or production data.

## Finding

The current guest experience automatically creates an anonymous Firebase Authentication user when no restored user session is available. The sign-out path also attempts to create a fresh anonymous session. A native push-registration fallback has also been observed attempting anonymous sign-in when no Firebase user is present.

This means repeated app launches, sign-outs, reinstallations, or scripted clients may generate additional anonymous identities. Client-side checks alone cannot reliably prevent this: an attacker can clear local storage, reinstall, modify the client, or call Firebase Auth APIs directly.

## Risk

- Unbounded or repeated anonymous account creation can consume project authentication quotas and create account clutter.
- A client-side install ID, local counter, cooldown, or retry limit is bypassable and must not be treated as an abuse-prevention boundary.
- Disabling anonymous authentication outright would break the existing guest experience and is not an acceptable silent mitigation.
- App Check is not currently ready for enforcement in this client. Enabling enforcement before a compatible attestation integration and rollout would risk blocking legitimate users and older APKs.

## Recommended server-side controls

1. Review Firebase Authentication / Identity Platform usage, anonymous-user creation volume, quota alerts, and abuse signals in the owning Google Cloud project.
2. Confirm whether the project is on Firebase Authentication with Identity Platform and whether Authentication blocking functions are available for the desired before-create policy. If supported, enforce a server-side policy there; do not rely on a client-provided device identifier as proof of device uniqueness.
3. If a blocking function is unavailable or unsuitable, design a trusted backend admission endpoint with rate limits and abuse signals before changing guest account creation. Never embed administrative credentials in the app.
4. Introduce Firebase App Check for the actual Capacitor Android distribution only after selecting and testing a supported attestation provider and compatible SDK/bridge. Start in monitoring mode, observe legitimate traffic, then enforce in stages.
5. Preserve guest access during rollout. Define a recovery path for users blocked by attestation or temporary backend failures.
6. Monitor anonymous-user creation and sign-in errors, quota exhaustion, and conversion from anonymous to permanent accounts. Alert on abnormal spikes.

## Safe client behavior

- Keep guest sign-in single-flight so simultaneous startup and push flows cannot race to create multiple sessions.
- Use bounded retry with exponential backoff for transient failures; do not loop indefinitely.
- Do not automatically create a new anonymous account after an explicit user sign-out unless the product flow intentionally offers a clearly visible “Continue as guest” action.
- Treat client-side cooldowns as UX safeguards only, not security controls.
- Do not delete or merge existing anonymous users automatically; account linking and migration need a separate tested flow.

## Implementation decision

No client code was changed in this audit. The repository does not contain enough verified server/project configuration in this review to safely deploy a blocking function, configure quotas, or enable App Check. Those changes require confirmation of the Firebase project’s enabled products, billing/plan, deployment environment, and production monitoring ownership.

## Validation still required

- Trace every anonymous sign-in call site and verify a single shared auth coordinator owns guest creation.
- Test cold start with no session, restored anonymous session, restored permanent session, sign-out, network loss, and rapid repeated startup.
- Verify push registration never creates an independent anonymous account while auth initialization is in progress.
- Confirm anonymous accounts cannot access protected social writes or account-owned records beyond intended guest permissions.
- Verify quota alerts and server-side controls in the Firebase/Google Cloud console before claiming abuse protection is active.

## Status

**Audit/documentation only.** No abuse-prevention control is enabled by this change. No Firebase Console setting, Cloud Function, database rule, production data, APK, subscription code, or NEXORA STUDIO file was modified.
