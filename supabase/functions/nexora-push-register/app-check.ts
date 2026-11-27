export type AppCheckStatus = "valid" | "missing" | "invalid";

type VerifiedAppCheckToken = {
  payload: { sub?: unknown };
  protectedHeader: { typ?: unknown };
};

export async function verifyAppCheckToken(
  token: string,
  expectedAppId: string,
  verifyJwt: (token: string) => Promise<VerifiedAppCheckToken>,
): Promise<AppCheckStatus> {
  if (!token.trim()) return "missing";
  try {
    const verified = await verifyJwt(token);
    return verified.protectedHeader.typ === "JWT" && verified.payload.sub === expectedAppId
      ? "valid"
      : "invalid";
  } catch {
    return "invalid";
  }
}

export function isAppCheckAllowed(status: AppCheckStatus, enforcementEnabled: boolean): boolean {
  return !enforcementEnabled || status === "valid";
}
