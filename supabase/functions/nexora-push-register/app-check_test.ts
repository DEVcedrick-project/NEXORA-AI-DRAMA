import { isAppCheckAllowed, verifyAppCheckToken } from "./app-check.ts";

const ANDROID_APP_ID = "1:201389649043:android:4dd0433ed5959b5e85f166";

Deno.test("valid NEXORA Android App Check token passes with enforcement enabled", async () => {
  const status = await verifyAppCheckToken("signed-android-token", ANDROID_APP_ID, async () => ({
    protectedHeader: { typ: "JWT" },
    payload: { sub: ANDROID_APP_ID },
  }));
  if (status !== "valid") throw new Error(`Expected valid, received ${status}`);
  if (!isAppCheckAllowed(status, true)) throw new Error("Valid Android attestation was rejected while enforcement was enabled.");
});

Deno.test("missing App Check token is rejected when enforcement is enabled", async () => {
  const status = await verifyAppCheckToken("  ", ANDROID_APP_ID, async () => {
    throw new Error("Verifier must not run for a missing token.");
  });
  if (status !== "missing") throw new Error(`Expected missing, received ${status}`);
  if (isAppCheckAllowed(status, true)) throw new Error("Missing App Check token was accepted.");
});

Deno.test("invalid App Check signature is rejected when enforcement is enabled", async () => {
  const status = await verifyAppCheckToken("tampered-token", ANDROID_APP_ID, async () => {
    throw new Error("JWT signature verification failed.");
  });
  if (status !== "invalid") throw new Error(`Expected invalid, received ${status}`);
  if (isAppCheckAllowed(status, true)) throw new Error("Invalid App Check token was accepted.");
});

Deno.test("token for a different Firebase app is rejected", async () => {
  const status = await verifyAppCheckToken("other-app-token", ANDROID_APP_ID, async () => ({
    protectedHeader: { typ: "JWT" },
    payload: { sub: "1:201389649043:android:other-app" },
  }));
  if (status !== "invalid") throw new Error(`Expected invalid, received ${status}`);
  if (isAppCheckAllowed(status, true)) throw new Error("A token issued for another Firebase app was accepted.");
});

Deno.test("enforcement-disabled rollout mode remains backward compatible", () => {
  if (!isAppCheckAllowed("missing", false)) throw new Error("Optional rollout mode unexpectedly rejected a missing token.");
});
