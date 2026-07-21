import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  type GlyphCallbackResponse,
} from "./index";
import { subscribeViaRelay, relayCallbackUrl } from "./relay-client";

// ── Inline relay for testing ───────────────────────────────────────────────

const results = new Map<string, unknown>();
const sseListeners = new Map<string, Set<(result: unknown) => void>>();

function storeResult(nonce: string, data: unknown) {
  results.set(nonce, data);
  const listeners = sseListeners.get(nonce);
  if (listeners) {
    for (const cb of listeners) {
      try { cb(data); } catch { /* */ }
    }
    sseListeners.delete(nonce);
  }
}

function waitForResult(nonce: string): { cancel: () => void } {
  const listeners = sseListeners.get(nonce) ?? new Set();
  sseListeners.set(nonce, listeners);
  const cancel = () => {
    listeners.clear();
    sseListeners.delete(nonce);
  };
  return { cancel };
}

function sseEvent(data: string, event: string): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`);
}

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);

      // POST /v1/callback/:nonce
      if (req.method === "POST" && url.pathname.startsWith("/v1/callback/")) {
        const nonce = url.pathname.slice("/v1/callback/".length);
        return req.json().then((body) => {
          storeResult(nonce, body);
          return new Response(JSON.stringify({ status: "ok" }), {
            headers: { "Content-Type": "application/json" },
          });
        });
      }

      // GET /v1/stream/:nonce
      if (req.method === "GET" && url.pathname.startsWith("/v1/stream/")) {
        const nonce = url.pathname.slice("/v1/stream/".length);
        const stored = results.get(nonce);

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            if (stored !== undefined) {
              controller.enqueue(sseEvent(JSON.stringify(stored), "result"));
              controller.enqueue(sseEvent("", "close"));
              controller.close();
              return;
            }

            const timer = setTimeout(() => {
              controller.enqueue(sseEvent(JSON.stringify({ status: "timeout" }), "timeout"));
              controller.close();
              cancel();
            }, 10_000);

            const { cancel } = waitForResult(nonce);

            const listeners = sseListeners.get(nonce);
            if (listeners) {
              listeners.clear();
              listeners.add((result: unknown) => {
                clearTimeout(timer);
                try {
                  controller.enqueue(sseEvent(JSON.stringify(result), "result"));
                  controller.enqueue(sseEvent("", "close"));
                  controller.close();
                } catch { /* */ }
              });
            }
          },
        });

        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server?.stop();
  results.clear();
  sseListeners.clear();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("relay client", () => {
  test("relayCallbackUrl builds the correct path", () => {
    expect(relayCallbackUrl("abc123", "https://relay.glyphq.org")).toBe(
      "https://relay.glyphq.org/v1/callback/abc123",
    );
  });

  test("relayCallbackUrl strips trailing slashes", () => {
    expect(relayCallbackUrl("abc", "https://relay.glyphq.org/")).toBe(
      "https://relay.glyphq.org/v1/callback/abc",
    );
  });

  test("relayCallbackUrl uses default relay URL", () => {
    expect(relayCallbackUrl("xyz")).toBe(
      "https://relay.glyphq.org/v1/callback/xyz",
    );
  });

  test("subscribeViaRelay resolves when result arrives after subscription", async () => {
    const nonce = `test_${crypto.randomUUID()}`;
    const signedResult: GlyphCallbackResponse = {
      status: "signed",
      type: "transfer",
      nonce,
      identity: "AAAA",
      tx_hash: "DEADBEEF",
      target_tick: 42,
    };

    // Subscribe first, then post
    const promise = subscribeViaRelay(nonce, {
      relayUrl: baseUrl,
      timeoutMs: 5_000,
    });

    // Give the SSE connection time to establish
    await new Promise((r) => setTimeout(r, 200));

    // Simulate wallet posting to the relay
    await fetch(`${baseUrl}/v1/callback/${nonce}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedResult),
    });

    const result = await promise;
    expect(result.status).toBe("signed");
    if (result.status === "signed" && (result.type === "transfer" || result.type === "sc_call")) {
      expect(result.tx_hash).toBe("DEADBEEF");
      expect(result.target_tick).toBe(42);
    }
  });

  test("subscribeViaRelay resolves immediately when result already exists", async () => {
    const nonce = `test_${crypto.randomUUID()}`;
    const rejectedResult: GlyphCallbackResponse = {
      status: "rejected",
      type: "connect",
      nonce,
      reason: "user_rejected",
    };

    // Post first, then subscribe
    await fetch(`${baseUrl}/v1/callback/${nonce}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rejectedResult),
    });

    const result = await subscribeViaRelay(nonce, {
      relayUrl: baseUrl,
      timeoutMs: 3_000,
    });

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toBe("user_rejected");
    }
  });

  test("subscribeViaRelay calls onStatus with progress events", async () => {
    const nonce = `test_${crypto.randomUUID()}`;
    const statuses: string[] = [];

    const promise = subscribeViaRelay(nonce, {
      relayUrl: baseUrl,
      timeoutMs: 5_000,
      onStatus: (s) => statuses.push(s.state),
    });

    await new Promise((r) => setTimeout(r, 200));

    await fetch(`${baseUrl}/v1/callback/${nonce}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "signed",
        type: "transfer",
        nonce,
        identity: "AAAA",
        tx_hash: "HASH",
        target_tick: 1,
      }),
    });

    await promise;
    expect(statuses).toContain("opening_wallet");
    expect(statuses).toContain("completed");
  });

  test("subscribeViaRelay rejects on timeout", async () => {
    const nonce = `test_timeout_${crypto.randomUUID()}`;
    await expect(
      subscribeViaRelay(nonce, {
        relayUrl: baseUrl,
        timeoutMs: 200,
      }),
    ).rejects.toThrow("Relay stream timed out");
  });
});
