import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { allowedOrigin, hasPushAdminRole, parseReconciliationRequest } from "./security.ts";

Deno.test("only trusted app_metadata grants push admin access", () => {
  assertEquals(hasPushAdminRole(null), false);
  assertEquals(hasPushAdminRole({ id: "u1", app_metadata: { nexora_push_admin: true } }), true);
  assertEquals(hasPushAdminRole({ id: "u1", app_metadata: { roles: ["nexora_push_admin"] } }), true);
  assertEquals(hasPushAdminRole({ id: "u1", app_metadata: { nexora_push_admin: "true" } }), false);
  assertEquals(hasPushAdminRole({ id: "u1", app_metadata: {}, user_metadata: { nexora_push_admin: true } } as never), false);
});

Deno.test("reconciliation request is strict and does not accept caller identity", () => {
  const valid = parseReconciliationRequest({
    deliveryId: "123e4567-e89b-42d3-a456-426614174000",
    evidenceReference: "provider-response-123", reason: "Verified FCM acceptance",
    operatorReference: "attacker-controlled",
  });
  assertEquals(valid, {
    deliveryId: "123e4567-e89b-42d3-a456-426614174000",
    evidenceReference: "provider-response-123", reason: "Verified FCM acceptance",
  });
  assertEquals(parseReconciliationRequest({ deliveryId: "not-a-uuid", evidenceReference: "x", reason: "y" }), null);
  assertEquals(parseReconciliationRequest({ deliveryId: "123e4567-e89b-42d3-a456-426614174000", evidenceReference: "", reason: "y" }), null);
  assertEquals(parseReconciliationRequest({ deliveryId: "123e4567-e89b-42d3-a456-426614174000", evidenceReference: "x", reason: " ".repeat(1001) }), null);
});

Deno.test("browser origins must be explicitly allowlisted", () => {
  assertEquals(allowedOrigin("https://admin.example", "https://admin.example,https://ops.example"), "https://admin.example");
  assertEquals(allowedOrigin("https://evil.example", "https://admin.example"), null);
  assertEquals(allowedOrigin(null, "https://admin.example"), null);
});
