export const PAGE_SIZE = 100;
export const MAX_ATTEMPTS = 5;
export const LEASE_SECONDS = 900;

export type Delivery = { token: string; attempt_count: number };
export type SendResult =
  | { kind: "sent" }
  | { kind: "invalid"; code: string }
  | { kind: "retryable"; code: string }
  | { kind: "permanent"; code: string }
  | { kind: "ambiguous"; code: string };

export interface PushWorkerStore {
  claim(eventKey: string, claimToken: string, leaseSeconds: number): Promise<boolean>;
  renew(eventKey: string, claimToken: string, leaseSeconds: number): Promise<boolean>;
  listDevices(after: string | null, limit: number): Promise<string[]>;
  seed(eventKey: string, tokens: string[]): Promise<void>;
  listDue(eventKey: string, after: string | null, limit: number): Promise<Delivery[]>;
  markSending(eventKey: string, token: string, attempt: number, at: string): Promise<boolean>;
  markSent(eventKey: string, token: string, at: string): Promise<void>;
  markInvalid(eventKey: string, token: string, at: string, code: string): Promise<void>;
  markAmbiguous(eventKey: string, token: string, at: string, code: string): Promise<void>;
  removeDevice(token: string): Promise<void>;
  markRetry(eventKey: string, token: string, nextAttemptAt: string, at: string, code: string): Promise<void>;
  markFailed(eventKey: string, token: string, at: string, code: string): Promise<void>;
  complete(eventKey: string, claimToken: string): Promise<boolean>;
  release(eventKey: string, claimToken: string): Promise<boolean>;
}

export type PushWorkerResult = {
  duplicate: boolean; sent: number; invalid: number; retried: number; failed: number; ambiguous: number; skipped: number;
};

export function retryDelayMs(attempt: number, random = Math.random): number {
  const base = Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base + random() * base * 0.2);
}

export async function processPushEvent(
  store: PushWorkerStore,
  send: (token: string) => Promise<SendResult>,
  eventKey: string,
  options: { claimToken?: string; now?: () => Date; random?: () => number } = {},
): Promise<PushWorkerResult> {
  const claimToken = options.claimToken ?? crypto.randomUUID();
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const result: PushWorkerResult = { duplicate: false, sent: 0, invalid: 0, retried: 0, failed: 0, ambiguous: 0, skipped: 0 };

  const claimed = await store.claim(eventKey, claimToken, LEASE_SECONDS);
  if (!claimed) return { ...result, duplicate: true };

  try {
    let deviceCursor: string | null = null;
    while (true) {
      if (!await store.renew(eventKey, claimToken, LEASE_SECONDS)) throw new Error("push_event_lease_lost");
      const tokens = await store.listDevices(deviceCursor, PAGE_SIZE);
      if (!tokens.length) break;
      await store.seed(eventKey, tokens);
      deviceCursor = tokens[tokens.length - 1];
      if (tokens.length < PAGE_SIZE) break;
    }

    let deliveryCursor: string | null = null;
    while (true) {
      if (!await store.renew(eventKey, claimToken, LEASE_SECONDS)) throw new Error("push_event_lease_lost");
      const rows = await store.listDue(eventKey, deliveryCursor, PAGE_SIZE);
      if (!rows.length) break;
      for (const row of rows) {
        deliveryCursor = row.token;
        if (!await store.renew(eventKey, claimToken, LEASE_SECONDS)) throw new Error("push_event_lease_lost");
        const attempt = Number(row.attempt_count || 0) + 1;
        const attemptedAt = now().toISOString();
        if (!await store.markSending(eventKey, row.token, attempt, attemptedAt)) {
          result.skipped++;
          continue;
        }

        let outcome: SendResult;
        try {
          outcome = await send(row.token);
        } catch {
          // A lost response may mean FCM accepted the send. Leave sending for reconciliation.
          result.skipped++;
          continue;
        }

        if (outcome.kind === "ambiguous") {
          result.skipped++;
          continue;
        }
        if (!await store.renew(eventKey, claimToken, LEASE_SECONDS)) throw new Error("push_event_lease_lost_after_response");

        if (outcome.kind === "sent") {
          await store.markSent(eventKey, row.token, now().toISOString());
          result.sent++;
        } else if (outcome.kind === "invalid") {
          await store.markInvalid(eventKey, row.token, now().toISOString(), outcome.code);
          await store.removeDevice(row.token);
          result.invalid++;
        } else if (outcome.kind === "permanent" || attempt >= MAX_ATTEMPTS) {
          await store.markFailed(eventKey, row.token, now().toISOString(), outcome.code);
          result.failed++;
        } else {
          const next = new Date(now().getTime() + retryDelayMs(attempt, random)).toISOString();
          await store.markRetry(eventKey, row.token, next, now().toISOString(), outcome.code);
          result.retried++;
        }
      }
      if (rows.length < PAGE_SIZE) break;
    }

    if (!await store.complete(eventKey, claimToken)) throw new Error("push_event_incomplete_pending_or_sending");
    return result;
  } catch (error) {
    // Always release incomplete work, even after partial success. Sent ledger rows are never reseeded.
    await store.release(eventKey, claimToken).catch(() => false);
    throw error;
  }
}
