import test from "node:test";
import assert from "node:assert/strict";
import { isAppCheckAllowed, verifyAppCheckToken } from "../supabase/functions/nexora-push-register/app-check.ts";

const ANDROID_APP_ID = "1:201389649043:android:4dd0433ed5959b5e85f166";

test("valid NEXORA Android App Check token passes with enforcement enabled", async () => {
  const status = await verifyAppCheckToken("signed-android-token", ANDROID_APP_ID, async () => ({
    protectedHeader: { typ: "JWT" },
    payload: { sub: ANDROID_APP_ID },
  }));
  assert.equal(status, "valid");
  assert.equal(isAppCheckAllowed(status, true), true);
});

test("missing App Check token is rejected when enforcement is enabled", async () => {
  const status = await verifyAppCheckToken(" ", ANDROID_APP_ID, async () => {
    throw new Error("Verifier must not run for a missing token.");
  });
  assert.equal(status, "missing");
  assert.equal(isAppCheckAllowed(status, true), false);
});

test("invalid App Check signature is rejected when enforcement is enabled", async () => {
  const status = await verifyAppCheckToken("tampered-token", ANDROID_APP_ID, async () => {
    throw new Error("JWT signature verification failed.");
  });
  assert.equal(status, "invalid");
  assert.equal(isAppCheckAllowed(status, true), false);
});

test("token issued for a different Firebase app is rejected", async () => {
  const status = await verifyAppCheckToken("other-app-token", ANDROID_APP_ID, async () => ({
    protectedHeader: { typ: "JWT" },
    payload: { sub: "1:201389649043:android:other-app" },
  }));
  assert.equal(status, "invalid");
  assert.equal(isAppCheckAllowed(status, true), false);
});

test("missing token remains allowed only while enforcement is disabled", () => {
  assert.equal(isAppCheckAllowed("missing", false), true);
});
