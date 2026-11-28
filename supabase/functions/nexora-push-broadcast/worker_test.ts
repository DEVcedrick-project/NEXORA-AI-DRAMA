import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { processPushEvent, type PushWorkerStore, type Delivery } from "./worker.ts";

class FakeStore implements PushWorkerStore {
  claimed = false;
  statuses = new Map<string, string>();
  attempts = new Map<string, number>();
  dueAt = new Map<string, number>();
  sendsRemoved: string[] = [];
  releaseCount = 0;
  tokens: string[];
  constructor(tokens: string[]) { this.tokens = tokens; }

  async claim(): Promise<boolean> {
    if (this.claimed) return false;
    this.claimed = true;
    return true;
  }
  async renew(): Promise<boolean> { return this.claimed; }
  async listDevices(after: string | null, limit: number): Promise<string[]> {
    return this.tokens.filter((token) => !after || token > after).slice(0, limit);
  }
  async seed(_event: string, tokens: string[]): Promise<void> {
    for (const token of tokens) {
      if (!this.statuses.has(token)) {
        this.statuses.set(token, "pending");
        this.attempts.set(token, 0);
        this.dueAt.set(token, 0);
      }
    }
  }
  async listDue(_event: string, after: string | null, limit: number): Promise<Delivery[]> {
    return [...this.statuses.entries()]
      .filter(([token, status]) => status === "pending" && (!after || token > after) && (this.dueAt.get(token) ?? 0) <= Date.now())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, limit)
      .map(([token]) => ({ token, attempt_count: this.attempts.get(token) ?? 0 }));
  }
  async markSending(_event: string, token: string, attempt: number): Promise<boolean> {
    if (this.statuses.get(token) !== "pending") return false;
    this.statuses.set(token, "sending");
    this.attempts.set(token, attempt);
    return true;
  }
  async markSent(_event: string, token: string): Promise<void> { this.statuses.set(token, "sent"); }
  async markInvalid(_event: string, token: string): Promise<void> { this.statuses.set(token, "invalid"); }
  async removeDevice(token: string): Promise<void> { this.sendsRemoved.push(token); }
  async markRetry(_event: string, token: string, next: string): Promise<void> {
    this.statuses.set(token, "pending");
    this.dueAt.set(token, Date.parse(next));
  }
  async markFailed(_event: string, token: string): Promise<void> { this.statuses.set(token, "failed"); }
  async complete(): Promise<boolean> {
    return ![...this.statuses.values()].some((status) => status === "pending" || status === "sending");
  }
  async release(): Promise<boolean> {
    this.claimed = false;
    this.releaseCount++;
    return true;
  }
}

Deno.test("partial success then retry resumes only pending tokens", async () => {
  const store = new FakeStore(["a", "b"]);
  const sent: string[] = [];
  const fixed = new Date("2026-11-28T00:00:00.000Z");
  await assertRejects(() => processPushEvent(store, async (token) => {
    sent.push(token);
    return token === "a" ? { kind: "sent" } : { kind: "retryable", code: "UNAVAILABLE" };
  }, "app_update:1.2.3", { claimToken: "claim-token-00000001", now: () => fixed, random: () => 0 }));
  assertEquals(store.statuses.get("a"), "sent");
  assertEquals(store.statuses.get("b"), "pending");
  assertEquals(store.releaseCount, 1);

  const later = new Date(fixed.getTime() + 20_000);
  const resumed = await processPushEvent(store, async (token) => {
    sent.push(token);
    return { kind: "sent" };
  }, "app_update:1.2.3", { claimToken: "claim-token-00000002", now: () => later });
  assertEquals(resumed.sent, 1);
  assertEquals(sent, ["a", "b", "b"]);
  assertEquals(store.statuses.get("a"), "sent");
  assertEquals(store.statuses.get("b"), "sent");
});

Deno.test("duplicate worker claim does not send a second copy", async () => {
  const store = new FakeStore(["a"]);
  store.claimed = true;
  let sends = 0;
  const result = await processPushEvent(store, async () => {
    sends++;
    return { kind: "sent" };
  }, "app_update:1.2.3", { claimToken: "claim-token-00000003" });
  assertEquals(result.duplicate, true);
  assertEquals(sends, 0);
});

Deno.test("ambiguous FCM outcome remains sending and is not retried", async () => {
  const store = new FakeStore(["a"]);
  let sends = 0;
  await assertRejects(() => processPushEvent(store, async () => {
    sends++;
    return { kind: "ambiguous", code: "NETWORK_TIMEOUT" };
  }, "app_update:1.2.3", { claimToken: "claim-token-00000004" }));
  assertEquals(store.statuses.get("a"), "sending");
  assertEquals(store.releaseCount, 1);
  assertEquals(sends, 1);
  await processPushEvent(store, async () => {
    sends++;
    return { kind: "sent" };
  }, "app_update:1.2.3", { claimToken: "claim-token-00000005" }).catch(() => {});
  assertEquals(sends, 1);
});

Deno.test("fifth retryable rejection becomes terminal failed", async () => {
  const store = new FakeStore(["a"]);
  store.statuses.set("a", "pending");
  store.attempts.set("a", 4);
  const fixed = new Date();
  const result = await processPushEvent(store, async () => ({
    kind: "retryable", code: "UNAVAILABLE",
  }), "app_update:1.2.3", { claimToken: "claim-token-00000006", now: () => fixed, random: () => 0 });
  assertEquals(result.failed, 1);
  assertEquals(store.statuses.get("a"), "failed");
});

Deno.test("permanent rejection is terminal and invalid token cleanup is scoped", async () => {
  const permanent = new FakeStore(["a"]);
  const permanentResult = await processPushEvent(permanent, async () => ({
    kind: "permanent", code: "SENDER_ID_MISMATCH",
  }), "app_update:1.2.3", { claimToken: "claim-token-00000007" });
  assertEquals(permanent.statuses.get("a"), "failed");
  assertEquals(permanentResult.failed, 1);

  const invalid = new FakeStore(["b"]);
  const invalidResult = await processPushEvent(invalid, async () => ({
    kind: "invalid", code: "UNREGISTERED",
  }), "app_update:1.2.3", { claimToken: "claim-token-00000008" });
  assertEquals(invalid.statuses.get("b"), "invalid");
  assertEquals(invalid.sendsRemoved, ["b"]);
  assertEquals(invalidResult.invalid, 1);
});
