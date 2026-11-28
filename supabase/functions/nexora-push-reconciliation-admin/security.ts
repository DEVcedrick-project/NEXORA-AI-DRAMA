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

export async function readJsonBody(
  request: Request,
  maxBytes = 8 * 1024,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: "too_large" | "invalid_json" }> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  if (!request.body) return { ok: false, reason: "invalid_json" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}
