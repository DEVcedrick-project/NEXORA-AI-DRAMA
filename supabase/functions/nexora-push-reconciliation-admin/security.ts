export type VerifiedUser = { id: string; app_metadata?: Record<string, unknown> };

export function hasPushAdminRole(user: VerifiedUser | null | undefined): boolean {
  if (!user?.id || !user.app_metadata) return false;
  const roles = Array.isArray(user.app_metadata.roles) ? user.app_metadata.roles : [];
  return user.app_metadata.nexora_push_admin === true || roles.includes("nexora_push_admin");
}

export function parseReconciliationRequest(value: unknown): {
  deliveryId: string; evidenceReference: string; reason: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const deliveryId = typeof body.deliveryId === "string" ? body.deliveryId : "";
  const evidenceReference = typeof body.evidenceReference === "string" ? body.evidenceReference.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deliveryId)) return null;
  if (!evidenceReference || evidenceReference.length > 512 || !reason || reason.length > 1000) return null;
  return { deliveryId, evidenceReference, reason };
}

export function allowedOrigin(origin: string | null, configured: string): string | null {
  if (!origin) return null;
  const allowed = configured.split(",").map((item) => item.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}
