import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const PROJECT_NUMBER = "201389649043";
const APP_ID = "1:201389649043:android:4dd0433ed5959b5e85f166";
const APP_CHECK_JWKS = createRemoteJWKSet(
  new URL("https://firebaseappcheck.googleapis.com/v1/jwks"),
  { cacheMaxAge: 6 * 60 * 60 * 1000 },
);

export type NexoraAppCheckStatus = "valid" | "missing" | "invalid";

export async function verifyNexoraAppCheck(request: Request): Promise<NexoraAppCheckStatus> {
  const token = (request.headers.get("x-firebase-appcheck") || "").trim();
  if (!token) return "missing";
  try {
    const { payload, protectedHeader } = await jwtVerify(token, APP_CHECK_JWKS, {
      algorithms: ["RS256"],
      issuer: `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`,
      audience: `projects/${PROJECT_NUMBER}`,
    });
    if (protectedHeader.typ !== "JWT" || payload.sub !== APP_ID) return "invalid";
    return "valid";
  } catch {
    return "invalid";
  }
}

export function enforceNexoraAppCheck(status: NexoraAppCheckStatus): boolean {
  return Deno.env.get("NEXORA_APP_CHECK_ENFORCE") === "true" && status !== "valid";
}
